const Stars = {
  _set: new Set(),

  key(stopId, route) {
    return stopId + ':' + route;
  },

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('hkbus_starred') || '[]');
      this._set = new Set(saved);
    } catch {
      this._set = new Set();
    }
  },

  _save() {
    localStorage.setItem('hkbus_starred', JSON.stringify([...this._set]));
  },

  has(stopId, route) {
    return this._set.has(this.key(stopId, route));
  },

  get size() {
    return this._set.size;
  },

  toggle(stopId, route) {
    const k = this.key(stopId, route);

    if (this._set.has(k)) {
      this._set.delete(k);
      this._save();
      if (typeof currentTargetIndex !== 'undefined') currentTargetIndex = 0;
      if (typeof AppRefresh === 'function') AppRefresh();
      return { changed: true, starred: false, limitReached: false };
    }

    if (this._set.size >= CONFIG.MAX_STARRED) {
      if (typeof uiToast === 'function') uiToast(t('maxStars'));
      return { changed: false, starred: false, limitReached: true };
    }

    this._set.add(k);
    this._save();
    if (typeof AppRefresh === 'function') AppRefresh();
    return { changed: true, starred: true, limitReached: false };
  }
};

// Initialize on script load
Stars.load();
