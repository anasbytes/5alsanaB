const { Expo } = require('expo-server-sdk');

const expo = new Expo();

// Added an optional `data` parameter (defaults to an empty object)
const sendPushNotification = async (pushToken, title, body, data = {}) => {
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
        console.log('Invalid or missing push token:', pushToken);
        return;
    }

    const message = {
        to: pushToken,
        sound: 'default',
        title,
        body,
        data, // <-- The frontend will use this to know which screen to open
    };

    try {
        const chunks = expo.chunkPushNotifications([message]);
        for (const chunk of chunks) {
            // Send the chunk and wait for the delivery tickets from Apple/Google
            let tickets = await expo.sendPushNotificationsAsync(chunk);
            
            // Optional: You can log the tickets here if you ever need to debug 
            // why a specific notification didn't arrive.
            // console.log('Push tickets:', tickets);
        }
    } catch (err) {
        console.error('Push notification error:', err);
    }
};

module.exports = { sendPushNotification };