/**
 * Handles all Firestore interactions for user data (farms, simulations, profile).
 */
(() => {
  'use strict';

  // Wait for Firebase to be ready
  const getDB = () => window.MittiFirebase?.db;

  window.MittiUserData = {
    /**
     * Ensure user document exists, or create it if missing.
     */
    async ensureUserProfile(user) {
      const db = getDB();
      if (!db || !user) return null;
      
      const userRef = db.collection('users').doc(user.uid);
      try {
        const doc = await userRef.get();
        if (!doc.exists) {
          await userRef.set({
            displayName: user.displayName || '',
            email: user.email || '',
            photoURL: user.photoURL || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        return (await userRef.get()).data();
      } catch (err) {
        console.error("Error ensuring user profile:", err);
      }
    },

    /**
     * Save a simulation result to user's history.
     */
    async saveSimulation(user, toolName, inputs, result) {
      const db = getDB();
      if (!db || !user) return;
      
      try {
        await db.collection('users').doc(user.uid).collection('simulations').add({
          tool: toolName,
          inputs: inputs, // e.g. { region_id: "...", crop_id: "..." }
          result: {
            profit: result.profit || result.expected_profit || null,
            yield: result.yield_kg_per_acre || result.total_yield_kg || null,
            // Keep preview data short
            preview: this._extractPreview(toolName, result)
          },
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error("Error saving simulation:", err);
      }
    },

    /**
     * Get recent simulations for the user's history panel.
     */
    async getHistory(user, limit = 10) {
      const db = getDB();
      if (!db || !user) return [];
      
      try {
        const snap = await db.collection('users').doc(user.uid)
          .collection('simulations')
          .orderBy('timestamp', 'desc')
          .limit(limit)
          .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.error("Error fetching history:", err);
        return [];
      }
    },

    _extractPreview(toolName, result) {
      if (toolName === 'simulate') return `Profit: ₹${Math.round(result.profit || 0)}`;
      if (toolName === 'recommend') return `Top crop: ${result[0]?.crop_name || '—'}`;
      if (toolName === 'rotation') return `Best: ${result.best_rotation?.kharif_crop} → ${result.best_rotation?.rabi_crop}`;
      if (toolName === 'forecast') return `Current: ₹${Math.round(result.current_price || 0)}/kg`;
      return 'Completed successfully';
    }
  };
})();
