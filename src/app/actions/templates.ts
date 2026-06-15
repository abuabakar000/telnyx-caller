'use server';

import { db } from '@/utils/db';

export async function getTemplates() {
  try {
    let templates = await db.template.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Seed default templates if none exist
    if (templates.length === 0) {
      await seedTemplates();
      templates = await db.template.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }

    return { success: true, templates };
  } catch (error: any) {
    console.error('[getTemplates Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function createTemplate(name: string, content: string) {
  try {
    if (!name || !content) {
      throw new Error('Template name and content are required.');
    }

    const template = await db.template.create({
      data: {
        name: name.trim(),
        content: content.trim(),
      },
    });

    return { success: true, template };
  } catch (error: any) {
    console.error('[createTemplate Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteTemplate(id: string) {
  try {
    const template = await db.template.delete({
      where: { id },
    });

    return { success: true, template };
  } catch (error: any) {
    console.error('[deleteTemplate Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function seedTemplates() {
  try {
    const defaultTemplates = [
      {
        name: 'Cold Outreach',
        content: 'Hi {Name}, this is the team at Inex Labs. We saw your profile and wanted to connect to share some of our new solutions. Do you have a few minutes for a quick chat this week?',
      },
      {
        name: 'Follow-Up Schedule',
        content: 'Hi {Name}, just following up on our call. Let me know if you would like me to send over the PDF brochure or schedule a live screen-share demo.',
      },
      {
        name: 'Promo Campaign',
        content: 'Hi {Name}, we are running a special 25% discount for new partners this month. Simply reply YES to this message if you want me to lock in your rate!',
      },
    ];

    const seeded = [];
    for (const temp of defaultTemplates) {
      const template = await db.template.create({
        data: temp,
      });
      seeded.push(template);
    }

    return { success: true, seeded };
  } catch (error: any) {
    console.error('[seedTemplates Error]:', error);
    return { success: false, error: error.message };
  }
}
