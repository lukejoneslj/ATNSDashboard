/**
 * data-manager.js
 * Central utility for handling dashboard state and data mapping.
 */

const DataManager = {
  KEYS: {
    JOTFORM: 'dashboard_jotform_data',
    ACCOUNTS: 'dashboard_accounts_data',
    FINANCIAL: 'dashboard_financial_data',
    GA4_SETTINGS: 'dashboard_ga4_settings',
    LAST_UPLOAD: 'dashboard_last_upload_meta'
  },

  DB_NAME: 'SymptomaticDashboardDB',
  STORE_NAME: 'dashboard_data',
  DB_VERSION: 1,

  /**
   * Initialize IndexedDB
   */
  async _getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /**
   * Check if we have the minimum required data (JotForm)
   */
  async hasData() {
    try {
      const data = await this.loadData(this.KEYS.JOTFORM);
      return data && data.length > 0;
    } catch (e) {
      return false;
    }
  },

  /**
   * Save data to IndexedDB
   */
  async saveData(key, data) {
    const db = await this._getDB();
    const tx = db.transaction(this.STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.put(data, key);
      request.onsuccess = () => {
        localStorage.setItem(this.KEYS.LAST_UPLOAD, new Date().toISOString());
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Helper to load data from IndexedDB
   */
  async loadData(key) {
    const db = await this._getDB();
    const tx = db.transaction(this.STORE_NAME, 'readonly');
    const store = tx.objectStore(this.STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Clear all dashboard data
   */
  async clearAll() {
    const db = await this._getDB();
    const tx = db.transaction(this.STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);
    store.clear();
    localStorage.removeItem(this.KEYS.LAST_UPLOAD);
  },

  /**
   * Map JotForm CSV headers to the format expected by the dashboard
   */
  mapJotFormCSV(rows) {
    return rows.map(row => {
      const keys = Object.keys(row);
      const findKey = (terms) => keys.find(k => terms.some(t => k.toLowerCase().includes(t.toLowerCase())));
      
      const answers = {
        '3':  row[findKey(["diagnostic testing"])] || "",
        '34': row[findKey(["organ disease"])] || "",
        '4':  row[findKey(["more than one symptom"])] || "",
        '7':  row[findKey(["increased by stress"])] || "",
        '8':  row[findKey(["detail-oriented", "self-critical"])] || "",
        '9':  row[findKey(["stress for you as a child"])] || "",
        '10': row[findKey(["amount of stress", "recently"])] || "",
        '11': row[findKey(["interest or pleasure", "depressed"])] || "",
        '12': row[findKey(["terrifying", "traumatic"])] || "",
        '40': row[findKey(["nervous", "anxious"])] || "",
        '35': row[findKey(["different areas", "move to different"])] || "",
        '36': row[findKey(["enter your email"])] || row[findKey(["Email"])] || "",
        '14': row[findKey(["child you care about"])] || "",
        '38': row[findKey(["Name"])] || "" 
      };

      const yesCount = ['3','34','4','7','8','9','10','11','12','40','35'].reduce((acc, qid) => {
        return acc + (String(answers[qid]).toLowerCase() === 'yes' ? 1 : 0);
      }, 0);
      answers['50'] = String(3 + yesCount);

      const dateKey = findKey(["Submission Date", "Date"]);
      let d = row[dateKey];
      if (d) {
        const dt = new Date(d);
        if (!isNaN(dt)) {
          d = dt.toISOString().split('T')[0] + ' 00:00:00';
        }
      }

      return { created_at: d, answers: answers };
    });
  },

  /**
   * Prune Accounts data to only include necessary fields
   */
  mapAccountsCSV(rows) {
    return rows.map(row => {
      const keys = Object.keys(row);
      const findKey = (terms) => 
        keys.find(k => terms.some(t => k.toLowerCase() === t.toLowerCase())) || 
        keys.find(k => terms.some(t => k.toLowerCase().includes(t.toLowerCase())));

      return {
        'Account Name': row[findKey(['Account Name', 'First Name'])] || "",
        'Email': row[findKey(['Email'])] || "",
        'Join Date': row[findKey(['Join Date'])],
        'ATNS Public': row[findKey(['ATNS Public'])],
        'ATNS Clinicians': row[findKey(['ATNS Clinicians'])],
        'ATNS Physicians': row[findKey(['ATNS Physicians'])],
        'ATNS Early Career': row[findKey(['ATNS Early Career'])],
        'Billing Method': row[findKey(['Billing Method'])],
        'Renewal Date': row[findKey(['Renewal Date'])],
        'Cancel': row[findKey(['Cancel'])]
      };
    });
  },

  /**
   * Prune Financial data to only include necessary fields
   */
  mapFinancialCSV(rows) {
    return rows.map(row => {
      const keys = Object.keys(row);
      const findKey = (terms) => 
        keys.find(k => terms.some(t => k.toLowerCase() === t.toLowerCase())) || 
        keys.find(k => terms.some(t => k.toLowerCase().includes(t.toLowerCase())));

      return {
        'Email': row[findKey(['Email'])] || "",
        'Date': row[findKey(['Date'])] || "",
        'Discount': row[findKey(['DiscountCode', 'Discount Code', 'Promo'])] || "",
        'Items': row[findKey(['Items', 'Item'])] || "",
        'Reference': row[findKey(['Reference'])] || "",
        'Transaction Type': row[findKey(['Transaction Type'])] || "",
        'Note': row[findKey(['Note'])] || "",
        'Billing Method': row[findKey(['Billing Method'])] || "",
        'Membership Sub-Total': parseFloat(row[findKey(['Membership Sub-Total', 'Sub-Total'])]) || 0
      };
    });
  },

  /**
   * GA4 API Methods
   */
  async getGA4Data(forceRefresh = false) {
    const settings = await this.loadData(this.KEYS.GA4_SETTINGS);
    if (!settings || !settings.propId || !settings.clientId) {
      console.warn("GA4 settings missing.");
      return null;
    }

    // Check if we already have valid data in IndexedDB
    const cached = await this.loadData('ga4_traffic_cache');
    if (cached && !forceRefresh) {
      const now = new Date().getTime();
      if (now - (cached.timestamp || 0) < 3600000) { // 1 hour cache
        return cached.data;
      }
    }

    try {
      const token = await this._authorize(settings.clientId);
      const data = await this._queryGA4(settings.propId, token);
      
      // Cache for 1 hour
      await this.saveData('ga4_traffic_cache', { data, timestamp: new Date().getTime() });
      return data;
    } catch (err) {
      console.error("GA4 Fetch failed:", err);
      throw err;
    }
  },

  /**
   * Internal OAuth2 token request
   */
  _authorize(clientId) {
    return new Promise((resolve, reject) => {
      if (typeof google === 'undefined') {
        reject(new Error("Google Identity Services script not loaded."));
        return;
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        callback: (response) => {
          if (response.error) {
            reject(response);
          } else {
            resolve(response.access_token);
          }
        },
      });
      client.requestAccessToken({ prompt: '' });
    });
  },

  /**
   * Internal API Query
   */
  async _queryGA4(propertyId, token) {
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    
    const body = {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'activeUsers' },
        { name: 'screenPageViews' }
      ]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "GA4 API Error");
    }

    return await response.json();
  }
};


