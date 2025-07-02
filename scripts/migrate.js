// scripts/migrate.js
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.local' });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ Please define MONGODB_URI in your .env.local file');
  process.exit(1);
}

// Migration state schema
const migrationStateSchema = new mongoose.Schema({
  version: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  appliedAt: { type: Date, default: Date.now },
  collections: [{ type: String }],
  status: { type: String, enum: ['completed', 'failed'], default: 'completed' }
});

let MigrationState;

class DatabaseMigrator {
  constructor() {
    this.currentVersion = 1;
    this.migrationName = 'Initial Database Setup with All Collections';
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      await mongoose.connect(MONGODB_URI, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4
      });
      
      console.log('✅ Connected to MongoDB');
      
      // Initialize migration state model
      MigrationState = mongoose.models.MigrationState || mongoose.model('MigrationState', migrationStateSchema);
      
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    try {
      await mongoose.disconnect();
      console.log('✅ Disconnected from MongoDB');
    } catch (error) {
      console.error('❌ Disconnect error:', error);
    }
  }

  /**
   * Run complete database migration with progress tracking
   */
  async runMigration() {
    const startTime = Date.now();
    
    try {
      await this.connect();
      
      console.log('🚀 Starting Database Migration...');
      console.log('='.repeat(60));
      
      // Check if migration already applied
      const existingMigration = await MigrationState.findOne({ version: this.currentVersion });
      if (existingMigration) {
        console.log('✅ Database migration already applied');
        console.log(`   Applied on: ${existingMigration.appliedAt}`);
        console.log(`   Collections: ${existingMigration.collections.join(', ')}`);
        return;
      }

      const results = [];
      
      // Run all collection migrations
      results.push(await this.migrateUsers());
      results.push(await this.migrateChats());
      results.push(await this.migrateMessages());
      results.push(await this.migrateGroups());
      results.push(await this.migrateCalls());
      results.push(await this.migrateStatus());
      results.push(await this.migrateContacts());
      results.push(await this.migrateMedia());
      results.push(await this.migrateNotifications());
      results.push(await this.migrateReports());
      results.push(await this.migrateAdmins());
      results.push(await this.migrateSettings());
      results.push(await this.migrateAnalytics());
      results.push(await this.migrateBroadcasts());

      // Show summary
      this.showMigrationSummary(results, startTime);
      
      // Save migration state
      await this.saveMigrationState(results);
      
      console.log('🎉 Database migration completed successfully!');
      console.log('='.repeat(60));

    } catch (error) {
      console.error('❌ Database migration failed:', error);
      throw error;
    }
  }

  /**
   * Create indexes with progress tracking
   */
  async createIndexes(collection, indexes, collectionName) {
    let created = 0;
    let existed = 0;

    for (const [index, indexDef] of indexes.entries()) {
      try {
        await collection.createIndex(indexDef.key, indexDef.options);
        created++;
        process.stdout.write(`\r    📝 Creating indexes: ${index + 1}/${indexes.length} - ${indexDef.options.name}`);
      } catch (error) {
        if (error.code === 85) { // Index already exists
          existed++;
          process.stdout.write(`\r    ⚠️  Index exists: ${index + 1}/${indexes.length} - ${indexDef.options.name}`);
        } else {
          console.error(`\n    ❌ Failed to create index ${indexDef.options.name}:`, error.message);
          throw error;
        }
      }
    }
    
    console.log(''); // New line after progress
    return { created, existed };
  }

  /**
   * Migrate Users Collection
   */
  async migrateUsers() {
    const startTime = Date.now();
    console.log('👥 Migrating Users Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('users');

      const indexes = [
        { key: { phoneNumber: 1 }, options: { unique: true, name: 'phoneNumber_unique' } },
        { key: { username: 1 }, options: { unique: true, sparse: true, name: 'username_unique' } },
        { key: { email: 1 }, options: { unique: true, sparse: true, name: 'email_unique' } },
        { key: { status: 1 }, options: { name: 'status_index' } },
        { key: { isOnline: 1 }, options: { name: 'isOnline_index' } },
        { key: { lastSeen: -1 }, options: { name: 'lastSeen_desc' } },
        { key: { createdAt: -1 }, options: { name: 'createdAt_desc' } },
        { key: { isVerified: 1 }, options: { name: 'isVerified_index' } },
        { key: { status: 1, isOnline: 1 }, options: { name: 'status_online_compound' } },
        { key: { phoneNumber: 1, status: 1 }, options: { name: 'phone_status_compound' } },
        { key: { contacts: 1 }, options: { name: 'contacts_array' } },
        { key: { blockedUsers: 1 }, options: { name: 'blockedUsers_array' } },
        { key: { deviceTokens: 1 }, options: { name: 'deviceTokens_array' } },
        { key: { 'devices.deviceId': 1 }, options: { name: 'devices_deviceId' } },
        { key: { 'devices.platform': 1 }, options: { name: 'devices_platform' } },
        { key: { 'devices.pushToken': 1 }, options: { sparse: true, name: 'devices_pushToken' } },
        { key: { tempOTPExpires: 1 }, options: { expireAfterSeconds: 0, name: 'tempOTP_ttl' } },
        { key: { displayName: 'text', username: 'text', phoneNumber: 'text' }, options: { name: 'user_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'users');
      const userCount = await collection.countDocuments();

      console.log(`    📊 Users collection: ${userCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'users',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'users',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Chats Collection
   */
  async migrateChats() {
    const startTime = Date.now();
    console.log('💬 Migrating Chats Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('chats');

      const indexes = [
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { participants: 1 }, options: { name: 'participants_array' } },
        { key: { lastMessage: 1 }, options: { name: 'lastMessage_ref' } },
        { key: { lastMessageTime: -1 }, options: { name: 'lastMessageTime_desc' } },
        { key: { encryptionKey: 1 }, options: { name: 'encryptionKey_index' } },
        { key: { 'groupInfo.name': 1 }, options: { name: 'group_name' } },
        { key: { 'groupInfo.creator': 1 }, options: { name: 'group_creator' } },
        { key: { 'groupInfo.admins': 1 }, options: { name: 'group_admins_array' } },
        { key: { 'groupInfo.inviteLink': 1 }, options: { unique: true, sparse: true, name: 'group_inviteLink_unique' } },
        { key: { 'unreadCount.userId': 1 }, options: { name: 'unreadCount_userId' } },
        { key: { 'isPinned.userId': 1 }, options: { name: 'pinned_userId' } },
        { key: { 'isArchived.userId': 1 }, options: { name: 'archived_userId' } },
        { key: { 'isMuted.userId': 1 }, options: { name: 'muted_userId' } },
        { key: { participants: 1, type: 1 }, options: { name: 'participants_type_compound' } },
        { key: { participants: 1, lastMessageTime: -1 }, options: { name: 'participants_lastMsg_compound' } },
        { key: { 'groupInfo.name': 'text', 'groupInfo.description': 'text' }, options: { name: 'group_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'chats');
      const chatCount = await collection.countDocuments();

      console.log(`    📊 Chats collection: ${chatCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'chats',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'chats',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Messages Collection
   */
  async migrateMessages() {
    const startTime = Date.now();
    console.log('📨 Migrating Messages Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('messages');

      const indexes = [
        { key: { chatId: 1, createdAt: -1 }, options: { name: 'chatId_createdAt_compound' } },
        { key: { senderId: 1 }, options: { name: 'senderId_index' } },
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { mediaId: 1 }, options: { name: 'mediaId_ref' } },
        { key: { status: 1 }, options: { name: 'status_index' } },
        { key: { isDeleted: 1 }, options: { name: 'isDeleted_index' } },
        { key: { isEdited: 1 }, options: { name: 'isEdited_index' } },
        { key: { isStarred: 1 }, options: { name: 'isStarred_index' } },
        { key: { replyTo: 1 }, options: { name: 'replyTo_ref' } },
        { key: { isForwarded: 1 }, options: { name: 'isForwarded_index' } },
        { key: { mentions: 1 }, options: { name: 'mentions_array' } },
        { key: { starredBy: 1 }, options: { name: 'starredBy_array' } },
        { key: { 'reactions.userId': 1 }, options: { name: 'reactions_userId' } },
        { key: { 'reactions.emoji': 1 }, options: { name: 'reactions_emoji' } },
        { key: { 'readBy.userId': 1 }, options: { name: 'readBy_userId' } },
        { key: { 'deliveredTo.userId': 1 }, options: { name: 'deliveredTo_userId' } },
        { key: { disappearsAt: 1 }, options: { expireAfterSeconds: 0, name: 'disappearing_ttl' } },
        { key: { chatId: 1, senderId: 1, createdAt: -1 }, options: { name: 'chat_sender_date_compound' } },
        { key: { chatId: 1, type: 1, createdAt: -1 }, options: { name: 'chat_type_date_compound' } },
        { key: { chatId: 1, isDeleted: 1, createdAt: -1 }, options: { name: 'chat_deleted_date_compound' } },
        { key: { content: 'text' }, options: { name: 'content_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'messages');
      const messageCount = await collection.countDocuments();

      console.log(`    📊 Messages collection: ${messageCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'messages',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'messages',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Groups Collection
   */
  async migrateGroups() {
    const startTime = Date.now();
    console.log('👥 Migrating Groups Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('groups');

      const indexes = [
        { key: { chatId: 1 }, options: { name: 'chatId_ref' } },
        { key: { name: 1 }, options: { name: 'name_index' } },
        { key: { creator: 1 }, options: { name: 'creator_ref' } },
        { key: { admins: 1 }, options: { name: 'admins_array' } },
        { key: { 'members.userId': 1 }, options: { name: 'members_userId' } },
        { key: { 'members.role': 1 }, options: { name: 'members_role' } },
        { key: { inviteLink: 1 }, options: { unique: true, name: 'inviteLink_unique' } },
        { key: { inviteCode: 1 }, options: { unique: true, name: 'inviteCode_unique' } },
        { key: { memberCount: 1 }, options: { name: 'memberCount_index' } },
        { key: { isActive: 1 }, options: { name: 'isActive_index' } },
        { key: { name: 'text', description: 'text' }, options: { name: 'group_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'groups');
      const groupCount = await collection.countDocuments();

      console.log(`    📊 Groups collection: ${groupCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'groups',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'groups',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Calls Collection
   */
  async migrateCalls() {
    const startTime = Date.now();
    console.log('📞 Migrating Calls Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('calls');

      const indexes = [
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { callType: 1 }, options: { name: 'callType_index' } },
        { key: { callerId: 1 }, options: { name: 'callerId_ref' } },
        { key: { 'participants.userId': 1 }, options: { name: 'participants_userId' } },
        { key: { 'participants.status': 1 }, options: { name: 'participants_status' } },
        { key: { chatId: 1 }, options: { name: 'chatId_ref' } },
        { key: { status: 1 }, options: { name: 'status_index' } },
        { key: { startTime: -1 }, options: { name: 'startTime_desc' } },
        { key: { endTime: -1 }, options: { name: 'endTime_desc' } },
        { key: { duration: 1 }, options: { name: 'duration_index' } },
        { key: { endReason: 1 }, options: { name: 'endReason_index' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'calls');
      const callCount = await collection.countDocuments();

      console.log(`    📊 Calls collection: ${callCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'calls',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'calls',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Status Collection
   */
  async migrateStatus() {
    const startTime = Date.now();
    console.log('📢 Migrating Status Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('status');

      const indexes = [
        { key: { userId: 1 }, options: { name: 'userId_ref' } },
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { mediaId: 1 }, options: { name: 'mediaId_ref' } },
        { key: { 'viewers.userId': 1 }, options: { name: 'viewers_userId' } },
        { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'expires_ttl' } },
        { key: { isActive: 1 }, options: { name: 'isActive_index' } },
        { key: { userId: 1, isActive: 1, createdAt: -1 }, options: { name: 'user_active_date' } },
        { key: { content: 'text' }, options: { name: 'content_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'status');
      const statusCount = await collection.countDocuments();

      console.log(`    📊 Status collection: ${statusCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'status',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'status',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Contacts Collection
   */
  async migrateContacts() {
    const startTime = Date.now();
    console.log('📱 Migrating Contacts Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('contacts');

      const indexes = [
        { key: { userId: 1 }, options: { name: 'userId_ref' } },
        { key: { contactUserId: 1 }, options: { name: 'contactUserId_ref' } },
        { key: { phoneNumber: 1 }, options: { name: 'phoneNumber_index' } },
        { key: { userId: 1, phoneNumber: 1 }, options: { unique: true, name: 'user_phone_unique' } },
        { key: { isRegistered: 1 }, options: { name: 'isRegistered_index' } },
        { key: { isBlocked: 1 }, options: { name: 'isBlocked_index' } },
        { key: { isFavorite: 1 }, options: { name: 'isFavorite_index' } },
        { key: { source: 1 }, options: { name: 'source_index' } },
        { key: { name: 'text', phoneNumber: 'text' }, options: { name: 'contact_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'contacts');
      const contactCount = await collection.countDocuments();

      console.log(`    📊 Contacts collection: ${contactCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'contacts',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'contacts',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Media Collection
   */
  async migrateMedia() {
    const startTime = Date.now();
    console.log('🎬 Migrating Media Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('media');

      const indexes = [
        { key: { uploadedBy: 1 }, options: { name: 'uploadedBy_ref' } },
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { mimeType: 1 }, options: { name: 'mimeType_index' } },
        { key: { size: 1 }, options: { name: 'size_index' } },
        { key: { s3Key: 1 }, options: { unique: true, name: 's3Key_unique' } },
        { key: { usage: 1 }, options: { name: 'usage_index' } },
        { key: { isDeleted: 1 }, options: { name: 'isDeleted_index' } },
        { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'expires_ttl' } },
        { key: { checksum: 1 }, options: { name: 'checksum_index' } },
        { key: { isEncrypted: 1 }, options: { name: 'isEncrypted_index' } },
        { key: { originalName: 'text' }, options: { name: 'filename_text_search' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'media');
      const mediaCount = await collection.countDocuments();

      console.log(`    📊 Media collection: ${mediaCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'media',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'media',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Notifications Collection
   */
  async migrateNotifications() {
    const startTime = Date.now();
    console.log('🔔 Migrating Notifications Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('notifications');

      const indexes = [
        { key: { userId: 1 }, options: { name: 'userId_ref' } },
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { isRead: 1 }, options: { name: 'isRead_index' } },
        { key: { deliveryStatus: 1 }, options: { name: 'deliveryStatus_index' } },
        { key: { priority: 1 }, options: { name: 'priority_index' } },
        { key: { scheduledFor: 1 }, options: { name: 'scheduledFor_index' } },
        { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'expires_ttl' } },
        { key: { 'platformDelivery.platform': 1 }, options: { name: 'platform_delivery' } },
        { key: { userId: 1, isRead: 1, createdAt: -1 }, options: { name: 'user_read_date' } },
        { key: { userId: 1, type: 1, createdAt: -1 }, options: { name: 'user_type_date' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'notifications');
      const notificationCount = await collection.countDocuments();

      console.log(`    📊 Notifications collection: ${notificationCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'notifications',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'notifications',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Reports Collection
   */
  async migrateReports() {
    const startTime = Date.now();
    console.log('🚨 Migrating Reports Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('reports');

      const indexes = [
        { key: { reporterId: 1 }, options: { name: 'reporterId_ref' } },
        { key: { reportedUserId: 1 }, options: { name: 'reportedUserId_ref' } },
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { category: 1 }, options: { name: 'category_index' } },
        { key: { status: 1 }, options: { name: 'status_index' } },
        { key: { priority: 1 }, options: { name: 'priority_index' } },
        { key: { assignedTo: 1 }, options: { name: 'assignedTo_ref' } },
        { key: { createdAt: -1 }, options: { name: 'createdAt_desc' } },
        { key: { status: 1, priority: 1, createdAt: -1 }, options: { name: 'status_priority_date' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'reports');
      const reportCount = await collection.countDocuments();

      console.log(`    📊 Reports collection: ${reportCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'reports',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'reports',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Admins Collection
   */
  async migrateAdmins() {
    const startTime = Date.now();
    console.log('👨‍💼 Migrating Admins Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('admins');

      const indexes = [
        { key: { username: 1 }, options: { unique: true, name: 'username_unique' } },
        { key: { email: 1 }, options: { unique: true, name: 'email_unique' } },
        { key: { role: 1 }, options: { name: 'role_index' } },
        { key: { isActive: 1 }, options: { name: 'isActive_index' } },
        { key: { lastLogin: -1 }, options: { name: 'lastLogin_desc' } },
        { key: { createdBy: 1 }, options: { name: 'createdBy_ref' } },
        { key: { twoFactorEnabled: 1 }, options: { name: 'twoFactor_index' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'admins');
      const adminCount = await collection.countDocuments();

      console.log(`    📊 Admins collection: ${adminCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'admins',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'admins',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Settings Collection
   */
  async migrateSettings() {
    const startTime = Date.now();
    console.log('⚙️  Migrating Settings Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('settings');

      const indexes = [
        { key: { category: 1 }, options: { name: 'category_index' } },
        { key: { key: 1 }, options: { name: 'key_index' } },
        { key: { category: 1, key: 1 }, options: { unique: true, name: 'category_key_unique' } },
        { key: { isPublic: 1 }, options: { name: 'isPublic_index' } },
        { key: { isEncrypted: 1 }, options: { name: 'isEncrypted_index' } },
        { key: { updatedBy: 1 }, options: { name: 'updatedBy_ref' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'settings');

      // Create default settings if none exist
      let seedDataCreated = 0;
      const settingsCount = await collection.countDocuments();
      if (settingsCount === 0) {
        console.log('    📝 Creating default settings...');
        const defaultSettings = [
          // ========================================
          // GENERAL SETTINGS
          // ========================================
          { category: 'general', key: 'app_name', value: 'WhatsApp Clone', type: 'string', description: 'Application name', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'general', key: 'app_version', value: '1.0.0', type: 'string', description: 'Application version', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'general', key: 'max_file_size', value: 16777216, type: 'number', description: 'Maximum file upload size in bytes (16MB)', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'general', key: 'maintenance_mode', value: false, type: 'boolean', description: 'Enable maintenance mode', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'general', key: 'support_email', value: 'support@whatsappclone.com', type: 'string', description: 'Support contact email', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'general', key: 'company_name', value: 'WhatsApp Clone Inc.', type: 'string', description: 'Company name', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // ========================================
          // FEATURE SETTINGS
          // ========================================
          { category: 'features', key: 'group_max_members', value: 256, type: 'number', description: 'Maximum members in a group', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'disappearing_messages', value: true, type: 'boolean', description: 'Enable disappearing messages', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'status_max_duration_seconds', value: 86400, type: 'number', description: 'Maximum status duration in seconds (24 hours)', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'voice_call_enabled', value: true, type: 'boolean', description: 'Enable voice calling', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'video_call_enabled', value: true, type: 'boolean', description: 'Enable video calling', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'max_call_participants', value: 8, type: 'number', description: 'Maximum participants in a group call', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'broadcast_enabled', value: true, type: 'boolean', description: 'Enable broadcast messages', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'features', key: 'message_reactions_enabled', value: true, type: 'boolean', description: 'Enable message reactions', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // ========================================
          // SECURITY SETTINGS
          // ========================================
          // JWT Security Settings
          { category: 'security', key: 'jwt_access_token_expiry', value: '1h', type: 'string', description: 'JWT access token expiry time', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'jwt_refresh_token_expiry', value: '30d', type: 'string', description: 'JWT refresh token expiry time', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'jwt_qr_token_expiry', value: '5m', type: 'string', description: 'JWT QR code token expiry time', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'jwt_admin_token_expiry', value: '8h', type: 'string', description: 'JWT admin token expiry time', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'jwt_issuer', value: 'whatsapp-clone', type: 'string', description: 'JWT token issuer', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'jwt_audience', value: 'whatsapp-clone-users', type: 'string', description: 'JWT token audience', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // OTP Settings
          { category: 'security', key: 'otp_length', value: 6, type: 'number', description: 'OTP code length', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'otp_expiry_minutes', value: 5, type: 'number', description: 'OTP expiry time in minutes', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'otp_max_attempts', value: 3, type: 'number', description: 'Maximum OTP verification attempts', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'otp_resend_cooldown', value: 60, type: 'number', description: 'OTP resend cooldown in seconds', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'otp_rate_limit_minutes', value: 1, type: 'number', description: 'OTP rate limit window in minutes', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // QR Code Settings
          { category: 'security', key: 'qr_session_expiry_minutes', value: 5, type: 'number', description: 'QR code session expiry in minutes', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'qr_max_concurrent_sessions', value: 3, type: 'number', description: 'Maximum concurrent QR sessions', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'qr_allowed_origins', value: ['*'], type: 'array', description: 'Allowed origins for QR authentication', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Security Settings
          { category: 'security', key: 'bcrypt_rounds', value: 12, type: 'number', description: 'Bcrypt hashing rounds', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'max_login_attempts', value: 5, type: 'number', description: 'Maximum login attempts before lockout', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'lockout_duration_minutes', value: 15, type: 'number', description: 'Account lockout duration in minutes', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'session_timeout_minutes', value: 60, type: 'number', description: 'User session timeout in minutes', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'require_two_factor', value: false, type: 'boolean', description: 'Require two-factor authentication', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'allowed_devices_per_user', value: 5, type: 'number', description: 'Maximum devices per user', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Rate Limiting Settings
          { category: 'security', key: 'rate_limit_login_window_ms', value: 900000, type: 'number', description: 'Login rate limit window in milliseconds (15 min)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'rate_limit_login_max_attempts', value: 5, type: 'number', description: 'Maximum login attempts per window', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'rate_limit_otp_window_ms', value: 300000, type: 'number', description: 'OTP rate limit window in milliseconds (5 min)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'rate_limit_otp_max_attempts', value: 3, type: 'number', description: 'Maximum OTP attempts per window', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'rate_limit_qr_window_ms', value: 600000, type: 'number', description: 'QR generation rate limit window in milliseconds (10 min)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'rate_limit_qr_max_attempts', value: 10, type: 'number', description: 'Maximum QR generation attempts per window', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Admin Settings
          { category: 'security', key: 'admin_default_role', value: 'support', type: 'string', description: 'Default admin role for new admins', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'admin_session_timeout_hours', value: 8, type: 'number', description: 'Admin session timeout in hours', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'security', key: 'admin_require_mfa', value: true, type: 'boolean', description: 'Require MFA for admin accounts', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // ========================================
          // AWS SETTINGS
          // ========================================
          { category: 'aws', key: 'region', value: 'us-east-1', type: 'string', description: 'AWS region', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 's3_bucket', value: 'whatsapp-clone-storage', type: 'string', description: 'S3 bucket for file storage', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 's3_bucket_public', value: 'whatsapp-clone-public', type: 'string', description: 'S3 bucket for public files', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 'cloudfront_domain', value: '', type: 'string', description: 'CloudFront distribution domain', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 'ses_sender_email', value: 'noreply@whatsappclone.com', type: 'string', description: 'SES sender email address', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 'ses_sender_name', value: 'WhatsApp Clone', type: 'string', description: 'SES sender name', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 'sns_topic_arn', value: '', type: 'string', description: 'SNS topic ARN for notifications', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'aws', key: 'lambda_function_prefix', value: 'whatsapp-clone', type: 'string', description: 'Lambda function name prefix', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // ========================================
          // EMAIL SETTINGS
          // ========================================
          { category: 'email', key: 'provider', value: 'ses', type: 'string', description: 'Email service provider (ses, smtp, sendgrid)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'from_email', value: 'noreply@whatsappclone.com', type: 'string', description: 'Default from email address', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'from_name', value: 'WhatsApp Clone', type: 'string', description: 'Default from name', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'reply_to_email', value: 'support@whatsappclone.com', type: 'string', description: 'Reply-to email address', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // SMTP Settings (if using SMTP provider)
          { category: 'email', key: 'smtp_host', value: '', type: 'string', description: 'SMTP server host', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'smtp_port', value: 587, type: 'number', description: 'SMTP server port', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'smtp_secure', value: true, type: 'boolean', description: 'Use secure SMTP connection', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'smtp_username', value: '', type: 'string', description: 'SMTP username', isPublic: false, isEncrypted: true, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'smtp_password', value: '', type: 'string', description: 'SMTP password', isPublic: false, isEncrypted: true, createdAt: new Date(), updatedAt: new Date() },
          
          // Email Template Settings
          { category: 'email', key: 'welcome_template_enabled', value: true, type: 'boolean', description: 'Enable welcome email template', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'otp_template_enabled', value: true, type: 'boolean', description: 'Enable OTP email template', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'email', key: 'password_reset_template_enabled', value: true, type: 'boolean', description: 'Enable password reset email template', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // ========================================
          // COTURN SETTINGS (WebRTC/Calling)
          // ========================================
          { category: 'coturn', key: 'enabled', value: true, type: 'boolean', description: 'Enable COTURN server for calls', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'stun_servers', value: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'], type: 'array', description: 'STUN server URLs', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'turn_servers', value: [], type: 'array', description: 'TURN server configurations', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'turn_username', value: '', type: 'string', description: 'TURN server username', isPublic: false, isEncrypted: true, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'turn_password', value: '', type: 'string', description: 'TURN server password', isPublic: false, isEncrypted: true, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'turn_ttl_seconds', value: 86400, type: 'number', description: 'TURN credential TTL in seconds (24 hours)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'ice_servers_refresh_interval', value: 3600, type: 'number', description: 'ICE servers refresh interval in seconds (1 hour)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'fallback_to_public_stun', value: true, type: 'boolean', description: 'Fallback to public STUN servers if TURN fails', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Call Quality Settings
          { category: 'coturn', key: 'video_bitrate_max', value: 2000000, type: 'number', description: 'Maximum video bitrate in bps (2 Mbps)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'audio_bitrate_max', value: 128000, type: 'number', description: 'Maximum audio bitrate in bps (128 kbps)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'coturn', key: 'call_timeout_seconds', value: 30, type: 'number', description: 'Call connection timeout in seconds', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // ========================================
          // PUSH NOTIFICATION SETTINGS
          // ========================================
          { category: 'push_notifications', key: 'enabled', value: true, type: 'boolean', description: 'Enable push notifications', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'provider', value: 'fcm', type: 'string', description: 'Push notification provider (fcm, apns, both)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Firebase Cloud Messaging (FCM) Settings
          { category: 'push_notifications', key: 'fcm_server_key', value: '', type: 'string', description: 'FCM server key', isPublic: false, isEncrypted: true, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'fcm_sender_id', value: '', type: 'string', description: 'FCM sender ID', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'fcm_project_id', value: '', type: 'string', description: 'Firebase project ID', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Apple Push Notification Service (APNS) Settings
          { category: 'push_notifications', key: 'apns_enabled', value: false, type: 'boolean', description: 'Enable APNS for iOS', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'apns_team_id', value: '', type: 'string', description: 'Apple team ID', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'apns_key_id', value: '', type: 'string', description: 'APNS key ID', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'apns_bundle_id', value: 'com.whatsappclone.app', type: 'string', description: 'iOS app bundle ID', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'apns_production', value: false, type: 'boolean', description: 'Use APNS production environment', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Web Push Settings
          { category: 'push_notifications', key: 'web_push_enabled', value: true, type: 'boolean', description: 'Enable web push notifications', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'vapid_public_key', value: '', type: 'string', description: 'VAPID public key for web push', isPublic: true, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'vapid_private_key', value: '', type: 'string', description: 'VAPID private key for web push', isPublic: false, isEncrypted: true, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'vapid_subject', value: 'mailto:support@whatsappclone.com', type: 'string', description: 'VAPID subject (mailto or https URL)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          
          // Notification Behavior Settings
          { category: 'push_notifications', key: 'default_sound', value: 'default', type: 'string', description: 'Default notification sound', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'badge_enabled', value: true, type: 'boolean', description: 'Enable app badge counts', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'group_notifications', value: true, type: 'boolean', description: 'Enable group notifications', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'call_notifications', value: true, type: 'boolean', description: 'Enable call notifications', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'quiet_hours_enabled', value: false, type: 'boolean', description: 'Enable quiet hours for notifications', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'quiet_hours_start', value: '22:00', type: 'string', description: 'Quiet hours start time (HH:MM)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() },
          { category: 'push_notifications', key: 'quiet_hours_end', value: '08:00', type: 'string', description: 'Quiet hours end time (HH:MM)', isPublic: false, isEncrypted: false, createdAt: new Date(), updatedAt: new Date() }
        ];
        await collection.insertMany(defaultSettings);
        seedDataCreated = defaultSettings.length;
        console.log(`    ✅ Created ${seedDataCreated} default settings`);
      }

      console.log(`    📊 Settings collection: ${settingsCount + seedDataCreated} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'settings',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'settings',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Analytics Collection
   */
  async migrateAnalytics() {
    const startTime = Date.now();
    console.log('📊 Migrating Analytics Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('analytics');

      const indexes = [
        { key: { type: 1, date: -1 }, options: { name: 'type_date_compound' } },
        { key: { date: -1 }, options: { name: 'date_desc' } },
        { key: { 'dimensions.userId': 1 }, options: { name: 'dimensions_userId' } },
        { key: { 'dimensions.region': 1 }, options: { name: 'dimensions_region' } },
        { key: { 'dimensions.platform': 1 }, options: { name: 'dimensions_platform' } },
        { key: { type: 1, 'dimensions.platform': 1, date: -1 }, options: { name: 'type_platform_date' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'analytics');
      const analyticsCount = await collection.countDocuments();

      console.log(`    📊 Analytics collection: ${analyticsCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'analytics',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'analytics',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Migrate Broadcasts Collection
   */
  async migrateBroadcasts() {
    const startTime = Date.now();
    console.log('📢 Migrating Broadcasts Collection...');

    try {
      const db = mongoose.connection.db;
      const collection = db.collection('broadcasts');

      const indexes = [
        { key: { createdBy: 1 }, options: { name: 'createdBy_ref' } },
        { key: { type: 1 }, options: { name: 'type_index' } },
        { key: { status: 1 }, options: { name: 'status_index' } },
        { key: { scheduledAt: 1 }, options: { name: 'scheduledAt_index' } },
        { key: { sentAt: -1 }, options: { name: 'sentAt_desc' } },
        { key: { createdAt: -1 }, options: { name: 'createdAt_desc' } },
        { key: { recipients: 1 }, options: { name: 'recipients_array' } },
        { key: { 'targeting.userIds': 1 }, options: { name: 'targeting_userIds' } },
        { key: { 'targeting.groups': 1 }, options: { name: 'targeting_groups' } }
      ];

      const indexResult = await this.createIndexes(collection, indexes, 'broadcasts');
      const broadcastCount = await collection.countDocuments();

      console.log(`    📊 Broadcasts collection: ${broadcastCount} documents, ${indexResult.created} new indexes, ${indexResult.existed} existing`);

      return {
        collection: 'broadcasts',
        indexesCreated: indexResult.created,
        indexesExisted: indexResult.existed,
        seedDataCreated: 0,
        status: 'success',
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        collection: 'broadcasts',
        indexesCreated: 0,
        indexesExisted: 0,
        seedDataCreated: 0,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Show migration summary
   */
  showMigrationSummary(results, startTime) {
    const totalDuration = Date.now() - startTime;
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const totalIndexes = results.reduce((sum, r) => sum + r.indexesCreated, 0);
    const totalExisting = results.reduce((sum, r) => sum + r.indexesExisted, 0);
    const totalSeedData = results.reduce((sum, r) => sum + r.seedDataCreated, 0);

    console.log('');
    console.log('📋 Migration Summary');
    console.log('='.repeat(60));
    console.log(`⏱️  Total Duration: ${totalDuration}ms`);
    console.log(`✅ Successful: ${successful}/${results.length} collections`);
    console.log(`❌ Failed: ${failed}/${results.length} collections`);
    console.log(`📝 New Indexes Created: ${totalIndexes}`);
    console.log(`⚠️  Existing Indexes: ${totalExisting}`);
    console.log(`🌱 Seed Data Created: ${totalSeedData} records`);
    console.log('');

    // Show detailed results
    console.log('📊 Detailed Results:');
    results.forEach(result => {
      const status = result.status === 'success' ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`   ${status} ${result.collection.padEnd(15)} | ${result.indexesCreated} new, ${result.indexesExisted} existing | ${duration}`);
      if (result.error) {
        console.log(`      Error: ${result.error}`);
      }
    });
    console.log('');
  }

  /**
   * Save migration state
   */
  async saveMigrationState(results) {
    const successfulCollections = results
      .filter(r => r.status === 'success')
      .map(r => r.collection);

    const migrationState = new MigrationState({
      version: this.currentVersion,
      name: this.migrationName,
      collections: successfulCollections,
      status: results.every(r => r.status === 'success') ? 'completed' : 'failed'
    });

    await migrationState.save();
    console.log(`💾 Migration state saved (v${this.currentVersion})`);
  }

  /**
   * Check migration status
   */
  async getStatus() {
    await this.connect();
    const migration = await MigrationState.findOne({ version: this.currentVersion });
    
    if (!migration) {
      return {
        version: this.currentVersion,
        status: 'pending',
        message: 'Migration has not been applied yet'
      };
    }

    return {
      version: migration.version,
      name: migration.name,
      status: migration.status,
      appliedAt: migration.appliedAt,
      collections: migration.collections,
      message: migration.status === 'completed' ? 'Migration completed successfully' : 'Migration failed'
    };
  }

  /**
   * Reset migration (for development only)
   */
  async resetMigration() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Migration reset is not allowed in production');
    }

    await this.connect();
    await MigrationState.deleteMany({});
    console.log('⚠️  Migration state has been reset');
  }
}

// CLI Handler
async function runMigrationScript() {
  const migrator = new DatabaseMigrator();
  
  try {
    const command = process.argv[2];
    
    switch (command) {
      case 'up':
      case 'run':
        console.log('🔄 Running database migrations...');
        await migrator.runMigration();
        break;
        
      case 'status':
        console.log('📊 Getting migration status...');
        const status = await migrator.getStatus();
        console.log('');
        console.log('Migration Status:');
        console.log('================');
        console.log(`Version: ${status.version}`);
        console.log(`Status: ${status.status}`);
        console.log(`Message: ${status.message}`);
        
        if (status.appliedAt) {
          console.log(`Applied: ${status.appliedAt}`);
        }
        
        if (status.collections && status.collections.length > 0) {
          console.log(`Collections: ${status.collections.join(', ')}`);
        }
        break;
        
      case 'reset':
        if (process.env.NODE_ENV === 'production') {
          console.error('❌ Reset is not allowed in production');
          process.exit(1);
        }
        console.log('⚠️  Resetting migration state...');
        await migrator.resetMigration();
        console.log('✅ Migration state reset completed');
        break;
        
      default:
        console.log('WhatsApp Clone - Database Migration Tool');
        console.log('========================================');
        console.log('');
        console.log('Usage: node scripts/migrate.js <command>');
        console.log('');
        console.log('Commands:');
        console.log('  up       - Run database migrations');
        console.log('  run      - Run database migrations (alias for up)');
        console.log('  status   - Show migration status');
        console.log('  reset    - Reset migration state (dev only)');
        console.log('');
        console.log('Examples:');
        console.log('  node scripts/migrate.js up');
        console.log('  npm run migrate');
        console.log('  npm run migrate:status');
        console.log('');
        console.log('Environment:');
        console.log(`  MONGODB_URI: ${MONGODB_URI ? '✅ Set' : '❌ Not set'}`);
        console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        process.exit(1);
    }
    
    console.log('✅ Migration script completed');
    
  } catch (error) {
    console.error('❌ Migration script failed:', error.message);
    process.exit(1);
  } finally {
    await migrator.disconnect();
  }
}

// Export for use in other files
module.exports = {
  DatabaseMigrator,
  runMigration: async () => {
    const migrator = new DatabaseMigrator();
    await migrator.runMigration();
    await migrator.disconnect();
  },
  getStatus: async () => {
    const migrator = new DatabaseMigrator();
    const status = await migrator.getStatus();
    await migrator.disconnect();
    return status;
  }
};

// Run if called directly
if (require.main === module) {
  runMigrationScript();
}