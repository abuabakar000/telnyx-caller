import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/utils/db';
import { pusherServer } from '@/utils/pusher';

// Ed25519 Webhook Signature Verification using Node's native crypto
function verifyTelnyxSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKeyBase64: string
): boolean {
  try {
    if (!signature || !timestamp || !publicKeyBase64) return false;

    // SubjectPublicKeyInfo (SPKI) DER-encoding prefix for a 32-byte Ed25519 public key
    const derPrefix = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    ]);
    const rawPublicKey = Buffer.from(publicKeyBase64, 'base64');
    
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([derPrefix, rawPublicKey]),
      format: 'der',
      type: 'spki'
    });

    const data = Buffer.from(timestamp + '|' + rawBody, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'base64');

    return crypto.verify(null, data, publicKey, signatureBuffer);
  } catch (err) {
    console.error('[Telnyx Webhook] Crypto signature verification exception:', err);
    return false;
  }
}

async function getOrCreateContact(phoneNumber: string) {
  let contact = await db.contact.findUnique({
    where: { phoneNumber }
  });
  if (!contact) {
    contact = await db.contact.create({
      data: {
        name: phoneNumber,
        phoneNumber,
        tags: ['New Lead'],
        notes: ''
      }
    });
    // Trigger Pusher update for contacts list
    await pusherServer.trigger('sms-channel', 'new-contact', contact).catch(e => {
      console.warn('[Pusher] Trigger new-contact warning:', e);
    });
  }
  return contact;
}

async function updateHealthStats(status: 'delivered' | 'failed' | 'optout' | 'blocked' | 'sent') {
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
        }
      });
    }

    const updateData: any = {};
    if (status === 'sent') {
      updateData.totalSent = { increment: 1 };
    } else if (status === 'delivered') {
      updateData.delivered = { increment: 1 };
    } else if (status === 'failed') {
      updateData.failed = { increment: 1 };
    } else if (status === 'optout') {
      updateData.optOut = { increment: 1 };
    } else if (status === 'blocked') {
      updateData.carrierBlocked = { increment: 1 };
    }

    await db.healthLog.update({
      where: { id: log.id },
      data: updateData
    });
  } catch (err) {
    console.error('[Webhook HealthLog] Failed to update health stats:', err);
  }
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('telnyx-signature-ed25519') || '';
    const timestamp = request.headers.get('telnyx-timestamp') || '';
    const rawBody = await request.text();

    const webhookSecret = process.env.TELNYX_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[Telnyx Webhook] TELNYX_WEBHOOK_SECRET is not configured.');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Verify webhook signature
    const isValid = verifyTelnyxSignature(rawBody, signature, timestamp, webhookSecret);
    if (!isValid) {
      console.warn('[Telnyx Webhook] Invalid webhook signature detected.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const eventData = JSON.parse(rawBody);
    const eventType = eventData.data?.event_type;
    const payload = eventData.data?.payload;

    if (!payload) {
      return NextResponse.json({ received: true });
    }

    console.log(`[Telnyx Webhook] Received event: ${eventType}, msgId: ${payload.id}`);

    // Case 1: Inbound message received
    if (eventType === 'message.received') {
      const fromNumber = payload.from?.phone_number || '';
      const toNumber = payload.to?.[0]?.phone_number || '';
      const text = payload.text || '';
      const msgId = payload.id;

      if (!fromNumber || !toNumber) {
        return NextResponse.json({ received: true });
      }

      // Auto-associate or create contact
      const contact = await getOrCreateContact(fromNumber);

      const message = await db.message.create({
        data: {
          direction: 'inbound',
          text,
          sender: fromNumber,
          recipient: toNumber,
          status: 'received',
          telnyxMessageId: msgId,
          contactId: contact.id
        }
      });

      // Handle opt-out tracking
      const cleanText = text.trim().toUpperCase();
      if (cleanText === 'STOP') {
        console.log(`[Telnyx Webhook] Opt-out requested by: ${fromNumber}`);
        await updateHealthStats('optout');
      }

      // Broadcast new message via Pusher
      await pusherServer.trigger('sms-channel', 'new-message', {
        ...message,
        contactName: contact.name
      }).catch(e => {
        console.warn('[Pusher] Trigger new-message warning:', e);
      });
    }
    
    // Case 2: Outbound message status updates
    else if (
      eventType === 'message.sent' || 
      eventType === 'message.delivered' || 
      eventType === 'message.failed' ||
      eventType === 'message.undelivered' ||
      eventType === 'message.delivery_failed'
    ) {
      const msgId = payload.id;
      let rawStatus = eventType.split('.').pop() || '';
      let status = (rawStatus === 'undelivered' || rawStatus === 'delivery_failed') ? 'failed' : rawStatus;

      // Find existing message by telnyxMessageId
      const existingMsg = await db.message.findFirst({
        where: { telnyxMessageId: msgId }
      });

      if (existingMsg) {
        const updateData: any = { status };
        
        if (status === 'failed') {
          const errors = payload.errors || [];
          const errorDetail = errors[0]?.detail || errors[0]?.title || 'Unknown transmission failure';
          const errorCode = errors[0]?.code || 'N/A';
          const carrier = payload.carrier || 'Unknown';

          updateData.errorReason = errorDetail;
          updateData.carrier = carrier;

          // Save carrier log for carrier block diagnostics
          await db.carrierLog.create({
            data: {
              messageId: existingMsg.id,
              phoneNumber: existingMsg.recipient,
              carrier,
              reason: errorDetail,
              code: errorCode
            }
          });

          // Check if it is a carrier block / compliance issue
          const isCarrierBlock = 
            errorDetail.toLowerCase().includes('spam') || 
            errorDetail.toLowerCase().includes('block') || 
            errorDetail.toLowerCase().includes('filter') || 
            errorCode === '40007' || // Telnyx carrier block code
            errorCode === '40008';

          await updateHealthStats('failed');
          if (isCarrierBlock) {
            await updateHealthStats('blocked');
          }
        } else if (status === 'delivered') {
          await updateHealthStats('delivered');
        }

        const message = await db.message.update({
          where: { id: existingMsg.id },
          data: updateData
        });

        // Broadcast status update
        await pusherServer.trigger('sms-channel', 'message-status-update', message).catch(e => {
          console.warn('[Pusher] Trigger status-update warning:', e);
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Telnyx Webhook] Exception during execution:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
