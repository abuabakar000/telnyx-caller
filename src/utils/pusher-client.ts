import Pusher from 'pusher-js';

export const pusherClient = typeof window !== 'undefined'
  ? new Pusher(
      process.env.NEXT_PUBLIC_PUSHER_KEY || 'mock_pusher_key',
      {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
        forceTLS: true,
      }
    )
  : null;
