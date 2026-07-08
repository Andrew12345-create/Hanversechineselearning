// js/offline-manager.js - Lightweight Offline Manager
class OfflineManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.storage = {
      // Use localStorage for small, simple data
      get(key) {
        try {
          return JSON.parse(localStorage.getItem(key));
        } catch {
          return null;
        }
      },
      set(key, data) {
        try {
          localStorage.setItem(key, JSON.stringify(data));
          return true;
        } catch (e) {
          // If localStorage is full, clear old data
          if (e.name === 'QuotaExceededError') {
            this.cleanOldData();
            try {
              localStorage.setItem(key, JSON.stringify(data));
              return true;
            } catch (e2) {
              console.warn('Storage full even after cleanup');
              return false;
            }
          }
          return false;
        }
      },
      remove(key) {
        localStorage.removeItem(key);
      },
      cleanOldData() {
        // Remove old quiz results, keep only last 10
        const quizzes = this.get('offline_quizzes') || [];
        if (quizzes.length > 10) {
          this.set('offline_quizzes', quizzes.slice(-10));
        }
        
        // Remove old lesson progress, keep only recent
        const progress = this.get('offline_progress') || {};
        const keys = Object.keys(progress);
        if (keys.length > 50) {
          const sorted = keys.sort((a, b) => 
            new Date(progress[b].timestamp) - new Date(progress[a].timestamp)
          );
          const keep = sorted.slice(0, 50);
          const newProgress = {};
          keep.forEach(k => newProgress[k] = progress[k]);
          this.set('offline_progress', newProgress);
        }
      }
    };
    
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🟢 Online — Syncing offline data...');
      this.syncAll();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('🔴 Offline — Working locally');
    });
  }

  // ---------- STORE DATA LOCALLY (Lightweight) ----------
  
  // Store quiz answer (only store ID + score, not full quiz)
  storeQuizResult(quizId, answers, score) {
    const quizzes = this.storage.get('offline_quizzes') || [];
    
    // Only store if not already stored (prevent duplicates)
    const exists = quizzes.find(q => q.quizId === quizId);
    if (exists) return;
    
    quizzes.push({
      quizId,
      answers,
      score,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 20 quizzes to save space
    if (quizzes.length > 20) {
      quizzes.shift();
    }
    
    this.storage.set('offline_quizzes', quizzes);
  }

  // Store progress update (lightweight)
  storeProgress(userId, lessonId, progressData) {
    const progress = this.storage.get('offline_progress') || {};
    
    // Only store essential data
    progress[`${userId}_${lessonId}`] = {
      lessonId,
      completed: progressData.completed || false,
      score: progressData.score || 0,
      xpEarned: progressData.xpEarned || 0,
      timestamp: new Date().toISOString()
    };
    
    this.storage.set('offline_progress', progress);
  }

  // Store XP (simple)
  storeXP(userId, xpAmount, source) {
    const xpData = this.storage.get('offline_xp') || [];
    
    xpData.push({
      userId,
      xp: xpAmount,
      source,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 XP entries
    if (xpData.length > 50) {
      xpData.splice(0, xpData.length - 50);
    }
    
    this.storage.set('offline_xp', xpData);
  }

  // Store achievement unlock
  storeAchievement(userId, achievementId) {
    const achievements = this.storage.get('offline_achievements') || [];
    
    const exists = achievements.find(a => 
      a.userId === userId && a.achievementId === achievementId
    );
    
    if (!exists) {
      achievements.push({
        userId,
        achievementId,
        timestamp: new Date().toISOString()
      });
      this.storage.set('offline_achievements', achievements);
    }
  }

  // Store current streak
  storeStreak(userId, streakCount, lastDate) {
    this.storage.set(`streak_${userId}`, {
      count: streakCount,
      lastDate: lastDate || new Date().toISOString().split('T')[0]
    });
  }

  // ---------- GET LOCAL DATA ----------
  
  getOfflineQuizzes() {
    return this.storage.get('offline_quizzes') || [];
  }

  getOfflineProgress() {
    return this.storage.get('offline_progress') || {};
  }

  getOfflineXP() {
    return this.storage.get('offline_xp') || [];
  }

  getOfflineAchievements() {
    return this.storage.get('offline_achievements') || [];
  }

  getStreak(userId) {
    return this.storage.get(`streak_${userId}`) || null;
  }

  // ---------- SYNC TO SERVER ----------
  
  async syncAll() {
    if (!this.isOnline) {
      console.log('Still offline, skipping sync');
      return;
    }

    try {
      // Get user ID
      const user = this.storage.get('hanverse_user');
      if (!user) {
        console.log('No user logged in, skipping sync');
        return;
      }

      const userId = user.id || user.userId;
      
      // 1. Sync quiz results
      const quizzes = this.getOfflineQuizzes();
      if (quizzes.length > 0) {
        await this.syncQuizzes(userId, quizzes);
      }

      // 2. Sync progress
      const progress = this.getOfflineProgress();
      if (Object.keys(progress).length > 0) {
        await this.syncProgress(userId, progress);
      }

      // 3. Sync XP
      const xpEntries = this.getOfflineXP();
      if (xpEntries.length > 0) {
        await this.syncXP(userId, xpEntries);
      }

      // 4. Sync achievements
      const achievements = this.getOfflineAchievements();
      if (achievements.length > 0) {
        await this.syncAchievements(userId, achievements);
      }

      // 5. Sync streak
      const streak = this.getStreak(userId);
      if (streak) {
        await this.syncStreak(userId, streak);
      }

      // Clear synced data from local storage
      this.clearSyncedData();

    } catch (error) {
      console.error('Sync failed:', error);
    }
  }

  // ---------- SYNC HELPERS ----------
  
  async syncQuizzes(userId, quizzes) {
    try {
      const response = await fetch('/api/sync/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, quizzes })
      });
      
      if (response.ok) {
        console.log(`✅ Synced ${quizzes.length} quiz results`);
        this.storage.remove('offline_quizzes');
      }
    } catch (error) {
      console.warn('Quiz sync failed, will retry later:', error);
    }
  }

  async syncProgress(userId, progress) {
    try {
      const progressArray = Object.values(progress);
      const response = await fetch('/api/sync/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, progress: progressArray })
      });
      
      if (response.ok) {
        console.log(`✅ Synced ${progressArray.length} progress entries`);
        this.storage.remove('offline_progress');
      }
    } catch (error) {
      console.warn('Progress sync failed, will retry later:', error);
    }
  }

  async syncXP(userId, xpEntries) {
    try {
      const totalXP = xpEntries.reduce((sum, entry) => sum + entry.xp, 0);
      const response = await fetch('/api/sync/xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, xp: totalXP, entries: xpEntries })
      });
      
      if (response.ok) {
        console.log(`✅ Synced ${xpEntries.length} XP entries (total: ${totalXP} XP)`);
        this.storage.remove('offline_xp');
      }
    } catch (error) {
      console.warn('XP sync failed, will retry later:', error);
    }
  }

  async syncAchievements(userId, achievements) {
    try {
      const response = await fetch('/api/sync/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, achievements })
      });
      
      if (response.ok) {
        console.log(`✅ Synced ${achievements.length} achievements`);
        this.storage.remove('offline_achievements');
      }
    } catch (error) {
      console.warn('Achievement sync failed, will retry later:', error);
    }
  }

  async syncStreak(userId, streak) {
    try {
      const response = await fetch('/api/sync/streak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...streak })
      });
      
      if (response.ok) {
        console.log(`✅ Synced streak: ${streak.count} days`);
        this.storage.remove(`streak_${userId}`);
      }
    } catch (error) {
      console.warn('Streak sync failed, will retry later:', error);
    }
  }

  clearSyncedData() {
    // Keep only essential data, clear temporary sync data
    const keysToKeep = ['hanverse_user', 'hanverse_token'];
    const allKeys = Object.keys(localStorage);
    
    allKeys.forEach(key => {
      if (!keysToKeep.includes(key) && 
          (key.startsWith('offline_') || key.startsWith('streak_'))) {
        // Only remove if it's sync data
        localStorage.removeItem(key);
      }
    });
  }

  // ---------- HELPERS ----------
  
  getConnectionStatus() {
    return this.isOnline ? 'online' : 'offline';
  }

  // Get total local storage usage (for monitoring)
  getStorageUsage() {
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length * 2; // UTF-16
      }
    }
    return (total / 1024).toFixed(2) + ' KB';
  }

  // Emergency cleanup if storage gets full
  emergencyCleanup() {
    // Remove old data, keep only last 7 days
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Clean quizzes
    const quizzes = this.storage.get('offline_quizzes') || [];
    const recentQuizzes = quizzes.filter(q => 
      new Date(q.timestamp) > sevenDaysAgo
    );
    this.storage.set('offline_quizzes', recentQuizzes);
    
    // Clean progress
    const progress = this.storage.get('offline_progress') || {};
    const recentProgress = {};
    Object.keys(progress).forEach(key => {
      if (new Date(progress[key].timestamp) > sevenDaysAgo) {
        recentProgress[key] = progress[key];
      }
    });
    this.storage.set('offline_progress', recentProgress);
    
    // Clean XP
    const xp = this.storage.get('offline_xp') || [];
    const recentXP = xp.filter(x => 
      new Date(x.timestamp) > sevenDaysAgo
    );
    this.storage.set('offline_xp', recentXP);
    
    console.log('🧹 Emergency cleanup completed');
  }
}

// Export singleton
const offlineManager = new OfflineManager();
export default offlineManager;