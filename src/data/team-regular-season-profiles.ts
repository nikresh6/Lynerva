// Generated from nflverse/nfldata data/games.csv.
// Only completed 2024-2026 regular-season games are included.
// Keep this file local so request-time modeling never depends on a historical data download.

export interface StaticTeamProfile {
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  recentPointsFor: number;
  recentPointsAgainst: number;
  marginStdDev: number;
  totalStdDev: number;
  latestSeason: number;
  latestWeek: number;
}

export const TEAM_REGULAR_SEASON_PROFILES: Record<string, StaticTeamProfile> = {
  "KC": {
    "games": 24,
    "pointsFor": 21.1667,
    "pointsAgainst": 18.5833,
    "recentPointsFor": 14.6667,
    "recentPointsAgainst": 17.6667,
    "marginStdDev": 14.6908,
    "totalStdDev": 9.5973,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "BAL": {
    "games": 24,
    "pointsFor": 27.0417,
    "pointsAgainst": 21.2917,
    "recentPointsFor": 29.3333,
    "recentPointsAgainst": 21.3333,
    "marginStdDev": 16.5221,
    "totalStdDev": 13.8898,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "PHI": {
    "games": 24,
    "pointsFor": 23.75,
    "pointsAgainst": 18.7917,
    "recentPointsFor": 22.1667,
    "recentPointsAgainst": 16.3333,
    "marginStdDev": 11.3232,
    "totalStdDev": 11.751,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "GB": {
    "games": 24,
    "pointsFor": 24.375,
    "pointsAgainst": 21.4167,
    "recentPointsFor": 19.8333,
    "recentPointsAgainst": 28.8333,
    "marginStdDev": 11.8045,
    "totalStdDev": 15.5619,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "ATL": {
    "games": 24,
    "pointsFor": 21.2917,
    "pointsAgainst": 23.75,
    "recentPointsFor": 20.5,
    "recentPointsAgainst": 24.1667,
    "marginStdDev": 13.6509,
    "totalStdDev": 13.7318,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "PIT": {
    "games": 24,
    "pointsFor": 22.7083,
    "pointsAgainst": 23.375,
    "recentPointsFor": 22.6667,
    "recentPointsAgainst": 18.5,
    "marginStdDev": 11.5181,
    "totalStdDev": 13.5355,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "BUF": {
    "games": 24,
    "pointsFor": 30.0833,
    "pointsAgainst": 22.9167,
    "recentPointsFor": 30,
    "recentPointsAgainst": 22.8333,
    "marginStdDev": 12.4155,
    "totalStdDev": 17.4481,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "ARI": {
    "games": 24,
    "pointsFor": 22.375,
    "pointsAgainst": 26.875,
    "recentPointsFor": 19.3333,
    "recentPointsAgainst": 33.1667,
    "marginStdDev": 12.656,
    "totalStdDev": 12.1019,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "CHI": {
    "games": 24,
    "pointsFor": 24.5417,
    "pointsAgainst": 25.2083,
    "recentPointsFor": 31.1667,
    "recentPointsAgainst": 24.1667,
    "marginStdDev": 13.7735,
    "totalStdDev": 18.7437,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "TEN": {
    "games": 24,
    "pointsFor": 16.7917,
    "pointsAgainst": 27.9583,
    "recentPointsFor": 20.6667,
    "recentPointsAgainst": 28.8333,
    "marginStdDev": 10.7407,
    "totalStdDev": 14.5908,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "CIN": {
    "games": 24,
    "pointsFor": 25.9167,
    "pointsAgainst": 27.375,
    "recentPointsFor": 27.8333,
    "recentPointsAgainst": 24.1667,
    "marginStdDev": 15.399,
    "totalStdDev": 17.074,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "NE": {
    "games": 24,
    "pointsFor": 25.2917,
    "pointsAgainst": 20.9167,
    "recentPointsFor": 30.3333,
    "recentPointsAgainst": 17.8333,
    "marginStdDev": 15.2196,
    "totalStdDev": 8.6325,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "IND": {
    "games": 24,
    "pointsFor": 26.25,
    "pointsAgainst": 26.25,
    "recentPointsFor": 22,
    "recentPointsAgainst": 34,
    "marginStdDev": 15.0275,
    "totalStdDev": 12.6834,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "HOU": {
    "games": 24,
    "pointsFor": 22.875,
    "pointsAgainst": 19.4583,
    "recentPointsFor": 28.6667,
    "recentPointsAgainst": 22.1667,
    "marginStdDev": 12.5175,
    "totalStdDev": 13.425,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "MIA": {
    "games": 24,
    "pointsFor": 20.4167,
    "pointsAgainst": 24.125,
    "recentPointsFor": 18.8333,
    "recentPointsAgainst": 27.5,
    "marginStdDev": 15.6524,
    "totalStdDev": 10.1424,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "JAX": {
    "games": 24,
    "pointsFor": 25.8333,
    "pointsAgainst": 19.375,
    "recentPointsFor": 36,
    "recentPointsAgainst": 15.5,
    "marginStdDev": 14.4161,
    "totalStdDev": 13.065,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "NO": {
    "games": 24,
    "pointsFor": 17.1667,
    "pointsAgainst": 23,
    "recentPointsFor": 25.6667,
    "recentPointsAgainst": 19.8333,
    "marginStdDev": 13.3536,
    "totalStdDev": 9.9244,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "CAR": {
    "games": 24,
    "pointsFor": 20.625,
    "pointsAgainst": 26.375,
    "recentPointsFor": 22,
    "recentPointsAgainst": 28.3333,
    "marginStdDev": 14.4891,
    "totalStdDev": 18.1946,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "NYG": {
    "games": 24,
    "pointsFor": 21.625,
    "pointsAgainst": 25.9167,
    "recentPointsFor": 24.1667,
    "recentPointsAgainst": 20.8333,
    "marginStdDev": 12.6645,
    "totalStdDev": 13.972,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "MIN": {
    "games": 24,
    "pointsFor": 22.5417,
    "pointsAgainst": 20.4167,
    "recentPointsFor": 26.5,
    "recentPointsAgainst": 12.3333,
    "marginStdDev": 16.6245,
    "totalStdDev": 12.1637,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "LAC": {
    "games": 24,
    "pointsFor": 22.5417,
    "pointsAgainst": 20.5,
    "recentPointsFor": 17.5,
    "recentPointsAgainst": 19,
    "marginStdDev": 15.1843,
    "totalStdDev": 10.519,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "LV": {
    "games": 24,
    "pointsFor": 15.4583,
    "pointsAgainst": 23.5417,
    "recentPointsFor": 14.8333,
    "recentPointsAgainst": 22.8333,
    "marginStdDev": 13.8216,
    "totalStdDev": 11.3329,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "SEA": {
    "games": 24,
    "pointsFor": 26.0417,
    "pointsAgainst": 17.75,
    "recentPointsFor": 24.3333,
    "recentPointsAgainst": 14.1667,
    "marginStdDev": 11.6711,
    "totalStdDev": 16.3095,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "DEN": {
    "games": 24,
    "pointsFor": 25.0417,
    "pointsAgainst": 19.5833,
    "recentPointsFor": 21.1667,
    "recentPointsAgainst": 20.6667,
    "marginStdDev": 12.3745,
    "totalStdDev": 14.9312,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "CLE": {
    "games": 24,
    "pointsFor": 15.0417,
    "pointsAgainst": 24.2083,
    "recentPointsFor": 15.8333,
    "recentPointsAgainst": 23.8333,
    "marginStdDev": 13.3047,
    "totalStdDev": 12.2341,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "DAL": {
    "games": 24,
    "pointsFor": 25.8333,
    "pointsAgainst": 28.6667,
    "recentPointsFor": 23.3333,
    "recentPointsAgainst": 32.8333,
    "marginStdDev": 13.3959,
    "totalStdDev": 11.1706,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "TB": {
    "games": 24,
    "pointsFor": 25,
    "pointsAgainst": 23.1667,
    "recentPointsFor": 21.3333,
    "recentPointsAgainst": 23.8333,
    "marginStdDev": 12.672,
    "totalStdDev": 12.4714,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "WAS": {
    "games": 24,
    "pointsFor": 23.125,
    "pointsAgainst": 25.9583,
    "recentPointsFor": 19.3333,
    "recentPointsAgainst": 25.3333,
    "marginStdDev": 14.2025,
    "totalStdDev": 12.3356,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "DET": {
    "games": 24,
    "pointsFor": 29.8333,
    "pointsAgainst": 25.0833,
    "recentPointsFor": 27,
    "recentPointsAgainst": 28.1667,
    "marginStdDev": 12.8037,
    "totalStdDev": 16.4869,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "LA": {
    "games": 24,
    "pointsFor": 27.4583,
    "pointsAgainst": 20.125,
    "recentPointsFor": 31.8333,
    "recentPointsAgainst": 27.1667,
    "marginStdDev": 12.0746,
    "totalStdDev": 18.4247,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "SF": {
    "games": 24,
    "pointsFor": 24.7083,
    "pointsAgainst": 23.0833,
    "recentPointsFor": 30.5,
    "recentPointsAgainst": 19.5,
    "marginStdDev": 14.1999,
    "totalStdDev": 18.1059,
    "latestSeason": 2026,
    "latestWeek": 1
  },
  "NYJ": {
    "games": 24,
    "pointsFor": 19.0417,
    "pointsAgainst": 28.125,
    "recentPointsFor": 12.8333,
    "recentPointsAgainst": 33,
    "marginStdDev": 13.1543,
    "totalStdDev": 14.1165,
    "latestSeason": 2026,
    "latestWeek": 1
  }
};
