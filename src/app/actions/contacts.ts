'use server';

import { db } from '@/utils/db';
import { pusherServer } from '@/utils/pusher';

export async function getContacts() {
  try {
    const contacts = await db.contact.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, contacts };
  } catch (error: any) {
    console.error('[getContacts Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function createContact(
  name: string,
  phoneNumber: string,
  tags: string[] = [],
  notes: string = '',
  email: string = '',
  company: string = ''
) {
  try {
    // Normalize phone number: strip spaces, dashes, parentheses. Keep only + and digits.
    const normalizedPhone = phoneNumber.replace(/[^0-9+]/g, '');
    let formattedPhone = normalizedPhone;
    
    // Default to US +1 prefix if not present
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.length === 10) {
        formattedPhone = '+1' + formattedPhone;
      } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
        formattedPhone = '+' + formattedPhone;
      } else {
        formattedPhone = '+' + formattedPhone; // fallback
      }
    }

    // Check if phone number already exists
    const existing = await db.contact.findUnique({
      where: { phoneNumber: formattedPhone }
    });

    if (existing) {
      // Upsert: update existing details and merge tags
      const updated = await db.contact.update({
        where: { id: existing.id },
        data: {
          name: name.trim() || existing.name,
          notes: notes.trim() || existing.notes,
          email: email.trim() || existing.email,
          company: company.trim() || existing.company,
          tags: Array.from(new Set([...existing.tags, ...tags.map(t => t.trim()).filter(Boolean)])),
        },
      });

      await pusherServer.trigger('sms-channel', 'update-contact', updated).catch(e => {
        console.warn('[Pusher] Trigger update-contact warning:', e);
      });

      return { success: true, contact: updated, upserted: true };
    }

    const contact = await db.contact.create({
      data: {
        name: name.trim() || formattedPhone,
        phoneNumber: formattedPhone,
        tags: tags.map(t => t.trim()).filter(Boolean),
        notes: notes.trim(),
        email: email.trim() || null,
        company: company.trim() || null,
      },
    });

    await pusherServer.trigger('sms-channel', 'new-contact', contact).catch(e => {
      console.warn('[Pusher] Trigger new-contact warning:', e);
    });

    return { success: true, contact };
  } catch (error: any) {
    console.error('[createContact Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function updateContact(
  id: string,
  data: { 
    name?: string; 
    phoneNumber?: string; 
    tags?: string[]; 
    notes?: string;
    email?: string;
    company?: string;
  }
) {
  try {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.notes !== undefined) updateData.notes = data.notes.trim();
    if (data.tags !== undefined) updateData.tags = data.tags.map(t => t.trim()).filter(Boolean);
    if (data.email !== undefined) updateData.email = data.email.trim() || null;
    if (data.company !== undefined) updateData.company = data.company.trim() || null;
    
    if (data.phoneNumber !== undefined) {
      const normalizedPhone = data.phoneNumber.replace(/[^0-9+]/g, '');
      let formattedPhone = normalizedPhone;
      if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.length === 10) {
          formattedPhone = '+1' + formattedPhone;
        } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
          formattedPhone = '+' + formattedPhone;
        } else {
          formattedPhone = '+' + formattedPhone;
        }
      }
      
      // Check duplicate phone number if it's changing
      const existing = await db.contact.findFirst({
        where: {
          phoneNumber: formattedPhone,
          id: { not: id }
        }
      });
      if (existing) {
        throw new Error(`A contact with phone number ${formattedPhone} already exists.`);
      }
      updateData.phoneNumber = formattedPhone;
    }

    const contact = await db.contact.update({
      where: { id },
      data: updateData,
    });

    await pusherServer.trigger('sms-channel', 'update-contact', contact).catch(e => {
      console.warn('[Pusher] Trigger update-contact warning:', e);
    });

    return { success: true, contact };
  } catch (error: any) {
    console.error('[updateContact Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteContact(id: string) {
  try {
    const contact = await db.contact.delete({
      where: { id },
    });

    await pusherServer.trigger('sms-channel', 'delete-contact', { id }).catch(e => {
      console.warn('[Pusher] Trigger delete-contact warning:', e);
    });

    return { success: true, contact };
  } catch (error: any) {
    console.error('[deleteContact Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function importContactsCSV(csvContent: string) {
  try {
    // Basic CSV parser
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('CSV file is empty or does not contain any contact records.');
    }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIndex = header.findIndex(h => h.includes('name'));
    const phoneIndex = header.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('tel'));
    const tagsIndex = header.findIndex(h => h.includes('tag'));
    const notesIndex = header.findIndex(h => h.includes('note'));
    const emailIndex = header.findIndex(h => h.includes('email') || h.includes('mail'));
    const companyIndex = header.findIndex(h => h.includes('company') || h.includes('firm') || h.includes('organization') || h.includes('org') || h.includes('affiliation'));

    if (phoneIndex === -1) {
      throw new Error('CSV must contain a header column for Phone / Phone Number.');
    }

    let importedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      // Split by comma, handling potential quotes (simple regex parser)
      const matches = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
      const row = matches.map(val => val.replace(/^"|"$/g, '').trim());

      const phone = row[phoneIndex];
      if (!phone) {
        failedCount++;
        continue;
      }

      const name = nameIndex !== -1 && row[nameIndex] ? row[nameIndex] : phone;
      const notes = notesIndex !== -1 && row[notesIndex] ? row[notesIndex] : '';
      const email = emailIndex !== -1 && row[emailIndex] ? row[emailIndex] : '';
      const company = companyIndex !== -1 && row[companyIndex] ? row[companyIndex] : '';

      let tags: string[] = ['Lead'];
      if (tagsIndex !== -1 && row[tagsIndex]) {
        tags = row[tagsIndex].split(';').map(t => t.trim()).filter(Boolean);
      }

      const res = await createContact(name, phone, tags, notes, email, company);
      if (res.success) {
        importedCount++;
      } else {
        failedCount++;
        errors.push(`Row ${i + 1} (${phone}): ${res.error}`);
      }
    }

    return {
      success: true,
      importedCount,
      failedCount,
      errors,
    };
  } catch (error: any) {
    console.error('[importContactsCSV Error]:', error);
    return { success: false, error: error.message };
  }
}
