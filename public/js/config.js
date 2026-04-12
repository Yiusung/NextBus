const CONFIG = {
  STOPS_URL: '/api/stops.json',
  DATA_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  DEFAULT_RADIUS: 150,
  MIN_RADIUS: 50,
  MAX_RADIUS: 200,
  LAT_PER_METER: 1 / 110574,
  LNG_PER_METER: 1 / 102470,
  MAX_STARRED: 5,
  POLL_INTERVAL_MS: 30000, // 30s auto-refresh
  DEFAULT_ROUTES_LIMIT: 10
};

const I18N = {
  tc: {
    appTitle:      'HK BUS ETA',
    nearbyStops:   '附近巴士站',
    stops:         '站',
    routes:        '條路線',
    eta:           '到站',
    noETA:         '暫無班次',
    maxStars:      '最多收藏 5 條路線',
    mapLabel:      '🌍地圖',
    loadingData:   '正在載入資料...',
    loadingPos:    '正在取得位置...',
    querying:      '正在查詢附近巴士站...',
    noStopsNearby: '當前範圍內沒有巴士站',
    dbError:       '資料庫開啟失敗',
    syncError:     '無法載入巴士站資料',
    posError:      '定位失敗',
    minutes:       '分',
    meters:        'm',
    km:            'km',
    disclaimerText: "資料由 DATA.GOV.HK 提供"
  },
  en: {
    appTitle:      'HK BUS ETA',
    nearbyStops:   'Nearby Stops',
    stops:         'stops',
    routes:        'routes',
    eta:           'ETA',
    noETA:         'No service',
    maxStars:      'Maximum 5 starred routes',
    mapLabel:      '🌍Map',
    loadingData:   'Loading data...',
    loadingPos:    'Getting location...',
    querying:      'Querying nearby stops...',
    noStopsNearby: 'No stops within current area',
    dbError:       'Database error',
    syncError:     'Failed to load bus stop data',
    posError:      'Location error',
    minutes:       'MIN',
    meters:        'm',
    km:            'km',
    disclaimerText: "Data provided by DATA.GOV.HK"
  }
};

function t(key) {
  const lang = localStorage.getItem('hkbus_lang') || 'tc';
  return (I18N[lang] && I18N[lang][key]) || key;
}
