const TelegramBot = require('node-telegram-bot-api');
const fuzz = require('fuzzball'); // For fuzzy matching

// Replace with your bot token
const token = '7586399636:AAFqRXh8zieCYXre-hnUYCRumINyCOnBFOY';
const bot = new TelegramBot(token, { polling: true });

// Data structures
const users = {}; // Store users' city and partner info
const waitingUsers = []; // List of users waiting for a connection
const activeChats = {}; // Store active chat pairs

// Normalize city names for comparison
const normalizeCity = (city) => {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/\s+/g, '') // Remove spaces
    .replace(/[^a-z0-9]/g, ''); // Remove special characters
};

// Fuzzy match cities
const isCityMatch = (city1, city2) => {
  const normalizedCity1 = normalizeCity(city1);
  const normalizedCity2 = normalizeCity(city2);
  const matchScore = fuzz.ratio(normalizedCity1, normalizedCity2);
  return matchScore > 80; // Match if score is above 80
};

// Remove a user from the waiting list
const removeFromWaitingList = (chatId) => {
  const index = waitingUsers.indexOf(chatId);
  if (index > -1) {
    waitingUsers.splice(index, 1);
  }
};

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Welcome to NearME Bot! 😊\n\nThis bot connects you with random users based on your location. Please tell me your city to get started.`,
    {
      reply_markup: {
        force_reply: true,
      },
    }
  ).then((sentMessage) => {
    bot.onReplyToMessage(sentMessage.chat.id, sentMessage.message_id, (reply) => {
      const city = reply.text.trim();
      users[chatId] = { city, partner: null };
      bot.sendMessage(chatId, `Thanks! Your city has been set to "${city}". Use /find to connect.`);
    });
  });
});


// Command: /find
bot.onText(/\/find/, (msg) => {
  const chatId = msg.chat.id;

  if (!users[chatId]) {
    bot.sendMessage(chatId, `Please start by setting up your city using /start.`);
    return;
  }

  if (users[chatId].partner) {
    bot.sendMessage(chatId, `You're already chatting. Use /end to disconnect.`);
    return;
  }

  // Add to waiting list if not already present
  if (!waitingUsers.includes(chatId)) {
    waitingUsers.push(chatId);
    bot.sendMessage(chatId, `🔎 Searching for a chat partner... Please wait.`);

    // Try to find a partner based on location
    const findPartner = () => {
      const potentialPartners = waitingUsers.filter(
        (id) =>
          id !== chatId &&
          !users[id].partner &&
          isCityMatch(users[id].city, users[chatId].city)
      );

      if (potentialPartners.length > 0) {
        const partnerId = potentialPartners[0];
        removeFromWaitingList(chatId);
        removeFromWaitingList(partnerId);

        users[chatId].partner = partnerId;
        users[partnerId].partner = chatId;

        activeChats[chatId] = partnerId;
        activeChats[partnerId] = chatId;

        bot.sendMessage(chatId, `🎉 You are now connected! Start chatting.`);
        bot.sendMessage(partnerId, `🎉 You are now connected! Start chatting.`);
      } else {
        // After 30 seconds, fall back to random connection
        setTimeout(() => {
          if (waitingUsers.includes(chatId) && !users[chatId].partner) {
            const randomPartnerId = waitingUsers.find(
              (id) => id !== chatId && !users[id].partner
            );

            if (randomPartnerId) {
              removeFromWaitingList(chatId);
              removeFromWaitingList(randomPartnerId);

              users[chatId].partner = randomPartnerId;
              users[randomPartnerId].partner = chatId;

              activeChats[chatId] = randomPartnerId;
              activeChats[randomPartnerId] = chatId;

              bot.sendMessage(chatId, `🎉 You are now connected randomly! Start chatting.`);
              bot.sendMessage(randomPartnerId, `🎉 You are now connected randomly! Start chatting.`);
            } else {
              bot.sendMessage(chatId, `⏳ No chat partner found. Please try again later.`);
              removeFromWaitingList(chatId);
            }
          }
        }, 30000);
      }
    };

    // Immediate partner search
    findPartner();
  }
});



// Broadcast ads to all users
const broadcastAd = (message) => {
  Object.keys(users).forEach((chatId) => {
    bot.sendMessage(chatId, message);
  });
};

// Command: /broadcast (Admin-Only Command)
bot.onText(/\/broadcast (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  // Check if the sender is the admin
  if (chatId.toString() === '6583101990') {
    broadcastAd(`📢 Advertisement:\n\n${message}`);
  } else {
    bot.sendMessage(chatId, `You don't have permission to use this command.`);
  }
});

// Relay media, stickers, GIFs, etc.
bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  if (activeChats[chatId]) {
    const partnerId = activeChats[chatId];
    if (msg.text) {
      bot.sendMessage(partnerId, msg.text);
    } else if (msg.photo) {
      bot.sendPhoto(partnerId, msg.photo[msg.photo.length - 1].file_id);
    } else if (msg.sticker) {
      bot.sendSticker(partnerId, msg.sticker.file_id);
    } else if (msg.document) {
      bot.sendDocument(partnerId, msg.document.file_id);
    } else if (msg.animation) {
      bot.sendAnimation(partnerId, msg.animation.file_id);
    }
  }
});

// Relay edited messages
bot.on('edited_message', (msg) => {
  const chatId = msg.chat.id;

  if (activeChats[chatId]) {
    const partnerId = activeChats[chatId];
    bot.sendMessage(partnerId, `✏️ Edited Message:\n${msg.text}`);
  }
});

// Timers-based media
bot.onText(/\/timed (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const seconds = parseInt(match[1]);

  if (isNaN(seconds) || seconds <= 0) {
    bot.sendMessage(chatId, `Please provide a valid number of seconds.`);
    return;
  }

  bot.sendMessage(chatId, `Send the media you want to share with a timer.`).then(() => {
    bot.once('message', (mediaMsg) => {
      if (mediaMsg.photo) {
        const photoId = mediaMsg.photo[mediaMsg.photo.length - 1].file_id;
        bot.sendPhoto(chatId, photoId).then((sentMessage) => {
          setTimeout(() => {
            bot.deleteMessage(chatId, sentMessage.message_id);
          }, seconds * 1000);
        });
      } else {
        bot.sendMessage(chatId, `Only photos are supported for timed messages currently.`);
      }
    });
  });
});

// Delete messages for everyone
bot.onText(/\/delete/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, `Reply to the message you want to delete.`).then(() => {
    bot.once('message', (replyMsg) => {
      if (replyMsg.reply_to_message) {
        bot.deleteMessage(chatId, replyMsg.reply_to_message.message_id).catch((err) =>
          bot.sendMessage(chatId, `Unable to delete the message.`)
        );
      } else {
        bot.sendMessage(chatId, `Please reply to a message to delete it.`);
      }
    });
  });
});


// Command: /end
bot.onText(/\/end/, (msg) => {
  const chatId = msg.chat.id;

  if (activeChats[chatId]) {
    const partnerId = activeChats[chatId];

    bot.sendMessage(partnerId, `Your chat partner has disconnected. Use /find to connect with someone else.`);
    bot.sendMessage(chatId, `You have been disconnected.`);

    // Clean up active chat
    users[chatId].partner = null;
    users[partnerId].partner = null;
    delete activeChats[chatId];
    delete activeChats[partnerId];
  } else {
    bot.sendMessage(chatId, `You're not in a chat right now. Use /find to connect.`);
  }
});

// Command: /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const waitingCount = waitingUsers.length;
  const connectedCount = Object.keys(activeChats).length / 2; // Each chat involves 2 users

  bot.sendMessage(
    chatId,
    `📊 Bot Status:\n\n👤 Waiting Users: ${waitingCount}\n🔗 Connected Chats: ${connectedCount}`
  );
});

// Command: /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Here are the commands you can use:\n\n/start - Set your city\n/find - Find a chat partner\n/end - Disconnect from chat\n/status - View waiting and connected users\n/help - Show this help message`
  );
});

