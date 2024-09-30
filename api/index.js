// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const cors = require('cors');

// Initialize Firebase Admin SDK with service account
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://authentication-app-e095d-default-rtdb.asia-southeast1.firebasedatabase.app',
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Function to generate a random OTP
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Function to send notifications
const sendDynamicNotification = async (fcmToken, title, body) => {
  const message = {
    notification: { title, body },
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

// Endpoint to handle phone number and send OTP
app.post('/api/phone', async (req, res) => {
  const { phoneNumber, fcmToken, deviceId } = req.body;

  if (!phoneNumber || !fcmToken || !deviceId) {
    return res.status(400).json({ error: 'Phone number, FCM token, and device ID are required' });
  }

  try {
    const db = admin.database();
    const ref = db.ref('phoneNumbers');

    const existingUser = await ref.orderByChild('phoneNumber').equalTo(phoneNumber).once('value');

    if (existingUser.exists()) {
      const userKey = Object.keys(existingUser.val())[0];
      const userData = existingUser.val()[userKey];

      if (userData.register === 'y') {
        return res.status(200).json({
          message: 'User is already registered.',
          register: 'y',
          phoneNumber: userData.phoneNumber,
          deviceId: userData.deviceId,
          fcmToken: userData.fcmToken,
        });
      }

      const otp = generateOTP();
      await ref.child(userKey).update({ otp });

      const notificationTitle = 'Resend OTP Code';
      const notificationBody = `Your OTP is ${otp}`;
      await sendDynamicNotification(fcmToken, notificationTitle, notificationBody);

      return res.status(200).json({
        message: 'Phone number already exists but not verified, OTP resent.',
        register: 'n',
        otp,
      });
    }

    const otp = generateOTP();
    await ref.push({ phoneNumber, fcmToken, deviceId, otp, register: 'n' });

    const notificationTitle = 'Your OTP Code';
    const notificationBody = `Your OTP is ${otp}`;
    await sendDynamicNotification(fcmToken, notificationTitle, notificationBody);

    res.status(200).json({
      message: 'Phone number saved, OTP sent.',
      otp,
      register: 'n',
    });
  } catch (error) {
    console.error('Error saving phone number and sending OTP:', error);
    res.status(500).json({ error: 'Failed to save phone number and send OTP' });
  }
});

// Endpoint to verify the OTP
app.post('/api/verify-otp', async (req, res) => {
  const { phoneNumber, otp } = req.body;

  if (!phoneNumber || !otp) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  try {
    const db = admin.database();
    const ref = db.ref('phoneNumbers');
    const userSnapshot = await ref.orderByChild('phoneNumber').equalTo(phoneNumber).once('value');

    if (!userSnapshot.exists()) {
      return res.status(400).json({ error: 'Phone number not found' });
    }

    const userKey = Object.keys(userSnapshot.val())[0];
    const userData = userSnapshot.val()[userKey];

    if (userData.otp === otp) {
      await ref.child(userKey).update({ register: 'y' });
      return res.status(200).json({ message: 'OTP verified, registration successful' });
    } else {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Endpoint to add user data
app.post('/api/add-data', async (req, res) => {
  const { name, phoneNumber, email, profilePic } = req.body;

  if (!name || !phoneNumber || !email || !profilePic) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const db = admin.database();
    const ref = db.ref('userData');
    await ref.push({ name, phoneNumber, email, profilePic });

    res.status(200).json({ message: 'Data saved successfully' });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// Endpoint to get user data by phone number
app.get('/api/user-data', async (req, res) => {
  try {
    const usersRef = admin.database().ref('userData');
    const snapshot = await usersRef.once('value');
    const usersData = snapshot.val() || {};

    const usersArray = Object.entries(usersData).map(([key, data]) => ({
      id: key,
      ...data,
    }));

    return res.status(200).json(usersArray);
  } catch (error) {
    console.error('Error fetching user data:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// Endpoint to add a post
app.post('/api/add-post', async (req, res) => {
  const { phoneNumber, caption, imageUrl } = req.body;

  if (!phoneNumber || !caption || !imageUrl) {
    return res.status(400).json({ error: 'Phone number, caption, and image URL are required' });
  }

  try {
    const db = admin.database();
    const ref = db.ref('posts');
    
    await ref.push({ phoneNumber, caption, imageUrl, createdAt: new Date().toISOString() });

    res.status(200).json({ message: 'Post added successfully', imageUrl });
  } catch (error) {
    console.error('Error saving post:', error);
    res.status(500).json({ error: 'Failed to save post' });
  }
});

// Endpoint to get all posts
app.get('/api/posts', async (req, res) => {
  try {
    const postsRef = admin.database().ref('posts');
    const snapshot = await postsRef.once('value');
    const postsData = snapshot.val() || {};

    const postsArray = Object.entries(postsData).map(([key, data]) => ({
      id: key,
      ...data,
    }));

    return res.status(200).json(postsArray);
  } catch (error) {
    console.error('Error fetching posts:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// Endpoint to edit a post
app.put('/api/edit-post/:id', async (req, res) => {
  const postId = req.params.id;
  const { userId, imageUrl, caption } = req.body;

  if (!userId || !imageUrl || !caption) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const postRef = admin.database().ref(`posts/${postId}`);
    const postSnapshot = await postRef.once('value');

    if (!postSnapshot.exists()) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const postData = postSnapshot.val();
    
    if (postData.phoneNumber !== userId) {
      return res.status(403).json({ error: 'You are not authorized to edit this post' });
    }

    await postRef.update({ imageUrl, caption });
    
    return res.status(200).json({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Error editing post:', error);
    return res.status(500).json({ error: 'Failed to edit post' });
  }
});

// Endpoint to delete a post
app.delete('/api/delete-post/:id', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;

  try {
    const postRef = admin.database().ref(`posts/${postId}`);
    const postSnapshot = await postRef.once('value');

    if (!postSnapshot.exists()) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const postData = postSnapshot.val();
    
    if (postData.phoneNumber !== userId) {
      return res.status(403).json({ error: 'You are not authorized to delete this post' });
    }

    await postRef.remove();

    return res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    return res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Export the API routes for Vercel
module.exports = app;