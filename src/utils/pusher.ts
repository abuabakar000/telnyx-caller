import Pusher from 'pusher';

export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || '1000001',
  key: process.env.PUSHER_KEY || 'mock_pusher_key',
  secret: process.env.PUSHER_SECRET || 'mock_pusher_secret',
  cluster: process.env.PUSHER_CLUSTER || 'us2',
  useTLS: true,
});
