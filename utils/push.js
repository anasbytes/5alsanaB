const { Expo } = require('expo-server-sdk');

const expo = new Expo();

const sendPushNotification = async (pushToken, title, body) => {
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
        console.log('Invalid or missing push token:', pushToken);
        return;
    }

    const message = {
        to: pushToken,
        sound: 'default',
        title,
        body,
    };

    try {
        const chunks = expo.chunkPushNotifications([message]);
        for (const chunk of chunks) {
            await expo.sendPushNotificationsAsync(chunk);
        }
    } catch (err) {
        console.error('Push notification error:', err);
    }
};

module.exports = { sendPushNotification };