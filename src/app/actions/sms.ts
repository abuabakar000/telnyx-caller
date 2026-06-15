'use server';

import { db } from '@/utils/db';
import { pusherServer } from '@/utils/pusher';

const TELNYX_API_KEY = process.env.TELNYX_API_KEY && process.env.TELNYX_API_KEY.includes('_')
  ? process.env.TELNYX_API_KEY
  : (process.env.TELNYX_CALL_API_KEY || process.env.TELNYX_API_KEY);
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;

export async function sendSMS(toPhoneNumber: string, text: string, contactId?: string) {
  try {
    if (!TELNYX_API_KEY || !TELNYX_PHONE_NUMBER) {
      throw new Error('Telnyx credentials are not fully configured in environment variables.');
    }

    // 1. Verify if the contact is opted out
    let contact = null;
    if (contactId) {
      contact = await db.contact.findUnique({ where: { id: contactId } });
    } else {
      contact = await db.contact.findUnique({ where: { phoneNumber: toPhoneNumber } });
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
        from: TELNYX_PHONE_NUMBER,
        to: toPhoneNumber,
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
          name: toPhoneNumber,
          phoneNumber: toPhoneNumber,
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
        sender: TELNYX_PHONE_NUMBER,
        recipient: toPhoneNumber,
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
    }).catch(e => {
      console.warn('[Pusher] Trigger new-message warning:', e);
    });

    return { success: true, message };
  } catch (error: any) {
    console.error('[sendSMS Action Error]:', error);
    return { success: false, error: error.message || 'Failed to send SMS.' };
  }
}

export async function getMessages(contactId: string) {
  try {
    const messages = await db.message.findMany({
      where: { contactId },
      orderBy: { timestamp: 'asc' },
    });
    return { success: true, messages };
  } catch (error: any) {
    console.error('[getMessages Action Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function getThreads() {
  try {
    // We want to fetch all messages grouped/ordered by contacts and return a summary of conversations
    // Since MongoDB doesn't do complex grouping easily in standard prisma without group-by,
    // we can retrieve all contacts and get their last message to build the thread inbox.
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
        };
      })
    );

    // Sort threads by last message timestamp (or contact updated timestamp if no messages exist)
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
