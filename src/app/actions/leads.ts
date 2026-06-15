'use server';

import { db } from '@/utils/db';

export interface LeadData {
  firstName: string;
  lastName: string;
  phone: string;
  company?: string;
  email?: string;
}

// Normalize phone number to E.164
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

export async function getLeads() {
  try {
    const leads = await db.lead.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return { success: true, leads };
  } catch (error: any) {
    console.error('[getLeads Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function importLeads(leadsData: LeadData[], importBatch?: string) {
  try {
    const batch = importBatch || `batch_${Date.now()}`;
    let importedCount = 0;
    let failedCount = 0;

    for (const lead of leadsData) {
      if (!lead.phone) { failedCount++; continue; }
      try {
        const phone = normalizePhone(lead.phone);
        await db.lead.upsert({
          where: { phone },
          update: {
            firstName: lead.firstName || '',
            lastName: lead.lastName || '',
            company: lead.company || null,
            email: lead.email || null,
          },
          create: {
            firstName: lead.firstName || '',
            lastName: lead.lastName || '',
            phone,
            company: lead.company || null,
            email: lead.email || null,
            status: 'New',
            importBatch: batch,
          },
        });
        importedCount++;
      } catch (e: any) {
        console.error('[importLeads] Row error:', e.message);
        failedCount++;
      }
    }

    return { success: true, importedCount, failedCount, importBatch: batch };
  } catch (error: any) {
    console.error('[importLeads Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function updateLeadStatus(
  id: string,
  status: string,
  disposition?: string,
  callbackAt?: string | null,
  notes?: string
) {
  try {
    const data: any = { status };
    if (disposition !== undefined) data.disposition = disposition;
    if (callbackAt !== undefined) data.callbackAt = callbackAt ? new Date(callbackAt) : null;
    if (notes !== undefined) data.notes = notes;

    const lead = await db.lead.update({
      where: { id },
      data,
    });
    return { success: true, lead };
  } catch (error: any) {
    console.error('[updateLeadStatus Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function addLeadEvent(
  leadId: string,
  type: 'call' | 'sms' | 'note',
  data: {
    direction?: string;
    disposition?: string;
    duration?: number;
    text?: string;
  }
) {
  try {
    const event = await db.leadEvent.create({
      data: {
        leadId,
        type,
        direction: data.direction || null,
        disposition: data.disposition || null,
        duration: data.duration || null,
        text: data.text || null,
      },
    });
    return { success: true, event };
  } catch (error: any) {
    console.error('[addLeadEvent Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function getLeadTimeline(leadId: string) {
  try {
    const events = await db.leadEvent.findMany({
      where: { leadId },
      orderBy: { timestamp: 'desc' },
    });

    // Also fetch SMS messages linked by phone number
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    let smsMessages: any[] = [];
    if (lead) {
      smsMessages = await db.message.findMany({
        where: { OR: [{ sender: lead.phone }, { recipient: lead.phone }] },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    }

    return { success: true, events, smsMessages, lead };
  } catch (error: any) {
    console.error('[getLeadTimeline Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function getDashboardStats() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEvents = await db.leadEvent.findMany({
      where: {
        type: 'call',
        timestamp: { gte: todayStart },
      },
    });

    const totalCalls = todayEvents.length;
    const connected = todayEvents.filter(e => e.duration && e.duration > 0).length;
    const vmDrops = todayEvents.filter(e => e.disposition === 'VM Left').length;
    const interested = todayEvents.filter(e => e.disposition === 'Interested').length;
    const connectRate = totalCalls > 0 ? Math.round((connected / totalCalls) * 100) : 0;

    return { success: true, stats: { totalCalls, connected, vmDrops, interested, connectRate } };
  } catch (error: any) {
    console.error('[getDashboardStats Error]:', error);
    return { success: false, error: error.message };
  }
}
