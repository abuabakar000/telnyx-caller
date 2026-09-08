'use server';

import { db } from '@/utils/db';
import { pusherServer } from '@/utils/pusher';

const TELNYX_API_KEY = process.env.TELNYX_API_KEY && process.env.TELNYX_API_KEY.includes('_')
  ? process.env.TELNYX_API_KEY
  : (process.env.TELNYX_CALL_API_KEY || process.env.TELNYX_API_KEY);
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

function getPhoneVariants(phone?: string): string[] {
  if (!phone) return [];
  const variants = new Set<string>();
  const raw = phone.trim();
  if (raw) variants.add(raw);
  const normalized = normalizePhone(raw);
  if (normalized) variants.add(normalized);
  const digits = raw.replace(/\D/g, '');
  if (digits) {
    variants.add(digits);
    if (digits.length === 11 && digits.startsWith('1')) {
      variants.add(digits.slice(1));
      variants.add(`+${digits}`);
    } else if (digits.length === 10) {
      variants.add(`1${digits}`);
      variants.add(`+1${digits}`);
    }
  }
  return Array.from(variants);
}

export async function sendSMS(
  toPhoneNumber: string, 
  text: string, 
  contactId?: string,
  fromPhoneNumber?: string
) {
  try {
    if (!TELNYX_API_KEY) {
      throw new Error('Telnyx API key is not configured in environment variables.');
    }

    const normalizedTo = normalizePhone(toPhoneNumber);
    const resolvedFrom = normalizePhone(
      fromPhoneNumber || TELNYX_PHONE_NUMBER || process.env.NEXT_PUBLIC_TELNYX_NUMBER || ''
    );

    if (!resolvedFrom) {
      throw new Error('No sender phone number configured for active line.');
    }

    // 1. Verify if the contact is opted out
    let contact = null;
    if (contactId) {
      contact = await db.contact.findUnique({ where: { id: contactId } });
    } else {
      contact = await db.contact.findUnique({ where: { phoneNumber: normalizedTo } });
    }

    if (contact && contact.tags.includes('Opted Out')) {
      throw new Error('Cannot send message: Contact has opted out (STOP).');
    }

    // 2. Format message text with compliance footer
    const complianceFooter = '\n\nTo stop, reply STOP.';
    let finalPayloadText = text;
    if (!text.endsWith(complianceFooter) && !text.toUpperCase().includes('STOP')) {
      finalPayloadText = `${text}${complianceFooter}`;
    }

    // 3. Make HTTP request to Telnyx API
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resolvedFrom,
        to: normalizedTo,
        text: finalPayloadText,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Telnyx API error: ${response.status} - ${errBody}`);
    }

    const resData = await response.json();
    const telnyxMsgId = resData.data?.id || null;

    // 4. Ensure we have a contact registered
    if (!contact) {
      contact = await db.contact.create({
        data: {
          name: normalizedTo,
          phoneNumber: normalizedTo,
          tags: ['Lead'],
          notes: '',
        },
      });
      // Trigger new contact Pusher event
      await pusherServer.trigger('sms-channel', 'new-contact', contact).catch(e => {
        console.warn('[Pusher] Trigger new-contact warning:', e);
      });
    }

    // 5. Store message record in Database
    const message = await db.message.create({
      data: {
        direction: 'outbound',
        text: finalPayloadText,
        sender: resolvedFrom,
        recipient: normalizedTo,
        status: 'sent',
        telnyxMessageId: telnyxMsgId,
        contactId: contact.id,
      },
    });

    // 6. Update health stats for sending
    try {
      let log = await db.healthLog.findFirst();
      if (!log) {
        log = await db.healthLog.create({
          data: {
            totalSent: 0,
            delivered: 0,
            failed: 0,
            optOut: 0,
            carrierBlocked: 0,
          },
        });
      }
      await db.healthLog.update({
        where: { id: log.id },
        data: { totalSent: { increment: 1 } },
      });
    } catch (healthErr) {
      console.error('[HealthLog Update Error]:', healthErr);
    }

    // 7. Trigger Pusher live notification
    await pusherServer.trigger('sms-channel', 'new-message', {
      ...message,
      contactName: contact.name,
      line: resolvedFrom,
    }).catch(e => {
      console.warn('[Pusher] Trigger new-message warning:', e);
    });

    return { success: true, message };
  } catch (error: any) {
    console.error('[sendSMS Action Error]:', error);
    return { success: false, error: error.message || 'Failed to send SMS.' };
  }
}

export async function getMessages(contactId: string, linePhoneNumber?: string) {
  try {
    const lineVariants = linePhoneNumber ? getPhoneVariants(linePhoneNumber) : [];
    let whereClause: any = { contactId };

    if (lineVariants.length > 0) {
      whereClause = {
        contactId,
        OR: [
          { sender: { in: lineVariants } },
          { recipient: { in: lineVariants } }
        ]
      };
    }

    const messages = await db.message.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
    });
    return { success: true, messages };
  } catch (error: any) {
    console.error('[getMessages Action Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function getThreads(linePhoneNumber?: string) {
  try {
    const lineVariants = linePhoneNumber ? getPhoneVariants(linePhoneNumber) : [];

    // If linePhoneNumber is provided, strictly isolate messages for this line
    if (lineVariants.length > 0) {
      const messages = await db.message.findMany({
        where: {
          OR: [
            { sender: { in: lineVariants } },
            { recipient: { in: lineVariants } }
          ]
        },
        orderBy: { timestamp: 'desc' },
        take: 1000,
      });

      const threadsMap = new Map<string, { contact: any; lastMessage: any; unreadCount: number }>();
      const contactIdsToFetch = new Set<string>();
      const phonesToFetch = new Set<string>();

      for (const msg of messages) {
        const isOutbound = msg.direction === 'outbound' || lineVariants.includes(msg.sender);
        const otherParty = isOutbound ? msg.recipient : msg.sender;
        const normOther = normalizePhone(otherParty) || otherParty;
        if (!normOther) continue;

        if (msg.contactId) contactIdsToFetch.add(msg.contactId);
        phonesToFetch.add(normOther);
      }

      const contacts = await db.contact.findMany({
        where: {
          OR: [
            { id: { in: Array.from(contactIdsToFetch) } },
            { phoneNumber: { in: Array.from(phonesToFetch) } }
          ]
        }
      });

      const contactByPhone = new Map<string, any>();
      const contactById = new Map<string, any>();
      for (const c of contacts) {
        contactById.set(c.id, c);
        contactByPhone.set(normalizePhone(c.phoneNumber), c);
      }

      for (const msg of messages) {
        const isOutbound = msg.direction === 'outbound' || lineVariants.includes(msg.sender);
        const otherParty = isOutbound ? msg.recipient : msg.sender;
        const normOther = normalizePhone(otherParty) || otherParty;
        if (!normOther) continue;

        const threadKey = normOther;
        if (!threadsMap.has(threadKey)) {
          let contact = (msg.contactId && contactById.get(msg.contactId)) || contactByPhone.get(normOther);
          if (!contact) {
            contact = {
              id: msg.contactId || normOther,
              name: normOther,
              phoneNumber: normOther,
              tags: ['Lead'],
              createdAt: msg.timestamp,
              updatedAt: msg.timestamp,
            };
          }

          threadsMap.set(threadKey, {
            contact,
            lastMessage: msg,
            unreadCount: (msg.direction === 'inbound' && msg.status === 'received') ? 1 : 0,
          });
        } else {
          if (msg.direction === 'inbound' && msg.status === 'received') {
            const entry = threadsMap.get(threadKey)!;
            entry.unreadCount += 1;
          }
        }
      }

      const threads = Array.from(threadsMap.values());
      threads.sort((a, b) => {
        const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
        const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;
        return timeB - timeA;
      });

      return { success: true, threads };
    }

    // Default legacy behavior if no linePhoneNumber provided:
    const contacts = await db.contact.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    const threads = await Promise.all(
      contacts.map(async (contact) => {
        const lastMessage = await db.message.findFirst({
          where: { contactId: contact.id },
          orderBy: { timestamp: 'desc' },
        });
        return {
          contact,
          lastMessage,
          unreadCount: 0,
        };
      })
    );

    threads.sort((a, b) => {
      const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : new Date(a.contact.updatedAt).getTime();
      const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : new Date(b.contact.updatedAt).getTime();
      return timeB - timeA;
    });

    return { success: true, threads };
  } catch (error: any) {
    console.error('[getThreads Action Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function getMessagesByPhone(phoneNumber: string, linePhoneNumber?: string) {
  try {
    const contactVariants = getPhoneVariants(phoneNumber);
    const lineVariants = linePhoneNumber ? getPhoneVariants(linePhoneNumber) : [];

    let contact = await db.contact.findFirst({
      where: { phoneNumber: { in: contactVariants } }
    });

    let whereClause: any;
    if (lineVariants.length > 0) {
      whereClause = {
        OR: [
          { sender: { in: lineVariants }, recipient: { in: contactVariants } },
          { sender: { in: contactVariants }, recipient: { in: lineVariants } }
        ]
      };
      if (contact) {
        whereClause.OR.push(
          { contactId: contact.id, sender: { in: lineVariants } },
          { contactId: contact.id, recipient: { in: lineVariants } }
        );
      }
    } else {
      whereClause = {
        OR: [
          { sender: { in: contactVariants } },
          { recipient: { in: contactVariants } }
        ]
      };
      if (contact) {
        whereClause.OR.push({ contactId: contact.id });
      }
    }

    const messages = await db.message.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
    });

    return { success: true, messages, contact };
  } catch (error: any) {
    console.error('[getMessagesByPhone Error]:', error);
    return { success: false, error: error.message };
  }
}

