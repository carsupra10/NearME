const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// Telegram Bot Token
const token = '7586399636:AAFqRXh8zieCYXre-hnUYCRumINyCOnBFOY';
const bot = new TelegramBot(token, { polling: true });

let waitingList = []; // Track users waiting for connections
const timeoutDuration = 2 * 60 * 1000; // 2 minutes timeout for inactivity

// Load user data from data.json
const loadUserData = () => {
  try {
    const data = fs.readFileSync('data.json');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
};

// Save user data to data.json
const saveUserData = (data) => {
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
};

// Safely send a message and check for errors
const safeSendMessage = async (chatId, text) => {
  try {
    await bot.sendMessage(chatId, text);
    return true;
  } catch (error) {
    if (error.response && error.response.body && error.response.body.error_code === 403) {
      return false; // User blocked the bot
    }
    console.error('Unexpected error while sending message:', error);
    return null;
  }
};

// Handle blocked users and disconnect them
const handleUserBlock = (userId) => {
  const userData = loadUserData();
  const currentUser = userData[userId];

  if (currentUser && currentUser.partnerId) {
    const partnerId = currentUser.partnerId;
    const partner = userData[partnerId];

    currentUser.isConnected = false;
    currentUser.partnerId = null;
    if (partner) {
      partner.isConnected = false;
      partner.partnerId = null;
      safeSendMessage(partnerId, 'Your partner has disconnected.');
    }

    saveUserData(userData);
  }
};

// Handle /start command to register users
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const userName = msg.from.first_name;

  const userData = loadUserData();

  if (!userData[userId]) {
    userData[userId] = {
      name: userName,
      city: '',
      gender: '',
      isConnected: false,
      partnerId: null,
      lastActive: Date.now(),
      blocked: false,
    };
    saveUserData(userData);

    bot.sendMessage(userId, 'Welcome! Use /profileupdate to set up your profile.');
  } else {
    bot.sendMessage(userId, 'You are already registered! Use /profileupdate to update your profile.');
  }
});

// Handle /profileupdate to update user details
bot.onText(/\/profileupdate/, (msg) => {
  const userId = msg.from.id;
  const userData = loadUserData();

  if (!userData[userId]) {
    bot.sendMessage(userId, 'Please register first using /start.');
    return;
  }

  bot.sendMessage(userId, 'Please enter your city name:');
  bot.once('message', (cityMsg) => {
    userData[userId].city = cityMsg.text;

    bot.sendMessage(userId, 'Please enter your gender (male/female/other):');
    bot.once('message', (genderMsg) => {
      userData[userId].gender = genderMsg.text;
      saveUserData(userData);
      bot.sendMessage(userId, 'Profile updated successfully!');
    });
  });
});

// Handle /find command to connect nearby users
bot.onText(/\/find/, (msg) => {
  const userId = msg.from.id;
  const userData = loadUserData();

  if (!userData[userId]) {
    bot.sendMessage(userId, 'Please register first using /start.');
    return;
  }

  const currentUser = userData[userId];
  if (currentUser.isConnected) {
    bot.sendMessage(userId, 'You are already connected to a user. Use /end to disconnect first.');
    return;
  }

  if (waitingList.includes(userId)) {
    bot.sendMessage(userId, 'You are already in the waiting list.');
    return;
  }

  currentUser.lastActive = Date.now();
  waitingList.push(userId);

  // Check for a match
  const partnerId = waitingList.find(
    (id) => id !== userId && !userData[id].isConnected && userData[id].city === currentUser.city
  );

  if (partnerId) {
    // Connect users
    waitingList = waitingList.filter((id) => id !== userId && id !== partnerId);

    currentUser.isConnected = true;
    currentUser.partnerId = partnerId;
    userData[partnerId].isConnected = true;
    userData[partnerId].partnerId = userId;

    saveUserData(userData);

    bot.sendMessage(userId, `Connected to ${userData[partnerId].name}. Use /end to disconnect.`);
    bot.sendMessage(partnerId, `Connected to ${currentUser.name}. Use /end to disconnect.`);
  } else {
    bot.sendMessage(userId, 'No nearby users found. Added to the waiting list.');
  }
});

// Handle /end command to disconnect users
bot.onText(/\/end/, (msg) => {
  const userId = msg.from.id;
  const userData = loadUserData();

  if (!userData[userId]) {
    bot.sendMessage(userId, 'Please register first using /start.');
    return;
  }

  const currentUser = userData[userId];
  if (!currentUser.isConnected) {
    bot.sendMessage(userId, 'You are not connected to anyone.');
    return;
  }

  const partnerId = currentUser.partnerId;

  // Disconnect both users
  if (partnerId) {
    const partner = userData[partnerId];
    partner.isConnected = false;
    partner.partnerId = null;
    bot.sendMessage(partnerId, 'Your partner has disconnected.');
  }

  currentUser.isConnected = false;
  currentUser.partnerId = null;

  saveUserData(userData);
  bot.sendMessage(userId, 'Disconnected successfully.');
});

// Handle messages between connected users and manage inactivity
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const userData = loadUserData();

  if (!userData[userId]) return;

  const currentUser = userData[userId];
  currentUser.lastActive = Date.now();

  if (currentUser.isConnected && currentUser.partnerId) {
    const partnerId = currentUser.partnerId;
    const success = await safeSendMessage(partnerId, `${currentUser.name}: ${msg.text}`);
    if (!success) {
      handleUserBlock(partnerId);
    }
  }

  // Disconnect inactive users
  const now = Date.now();
  Object.keys(userData).forEach((id) => {
    const user = userData[id];
    if (user.isConnected && now - user.lastActive > timeoutDuration) {
      const partnerId = user.partnerId;
      user.isConnected = false;
      user.partnerId = null;

      if (partnerId && userData[partnerId]) {
        userData[partnerId].isConnected = false;
        userData[partnerId].partnerId = null;
        bot.sendMessage(partnerId, 'Your partner has been disconnected due to inactivity.');
      }

      bot.sendMessage(id, 'You have been disconnected due to inactivity.');
    }
  });

  saveUserData(userData);
});

