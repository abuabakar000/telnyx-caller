'use server';

import { db } from '@/utils/db';

export async function getHealthStats() {
  try {
    let stats = await db.healthLog.findFirst();
    if (!stats) {
      stats = await db.healthLog.create({
        data: {
          totalSent: 0,
          delivered: 0,
          failed: 0,
          optOut: 0,
          carrierBlocked: 0,
        },
      });
    }

    const logs = await db.carrierLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    const carrierLogs = await Promise.all(
      logs.map(async (log) => {
        let messageText = '';
        if (log.messageId) {
          try {
            const msg = await db.message.findUnique({ where: { id: log.messageId } });
            if (msg) messageText = msg.text;
          } catch (e) {}
        }
        return {
          ...log,
          messageText,
        };
      })
    );

    return {
      success: true,
      stats,
      carrierLogs,
    };
  } catch (error: any) {
    console.error('[getHealthStats Error]:', error);
    return { success: false, error: error.message };
  }
}

export async function resetHealthStats() {
  try {
    let stats = await db.healthLog.findFirst();
    if (stats) {
      await db.healthLog.update({
        where: { id: stats.id },
        data: {
          totalSent: 0,
          delivered: 0,
          failed: 0,
          optOut: 0,
          carrierBlocked: 0,
        },
      });
    } else {
      await db.healthLog.create({
        data: {
          totalSent: 0,
          delivered: 0,
          failed: 0,
          optOut: 0,
          carrierBlocked: 0,
        },
      });
    }

    // Clean diagnostic carrier logs
    await db.carrierLog.deleteMany({});

    return { success: true };
  } catch (error: any) {
    console.error('[resetHealthStats Error]:', error);
    return { success: false, error: error.message };
  }
}
