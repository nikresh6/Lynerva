import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = integer("created_at", { mode: "timestamp" })
  .notNull()
  .default(sql`(unixepoch())`);
const updatedAt = integer("updated_at", { mode: "timestamp" })
  .notNull()
  .default(sql`(unixepoch())`)
  .$onUpdate(() => new Date());

// Better Auth core tables. Property names intentionally follow Better Auth's
// adapter contract while SQL names remain conventional snake_case.
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    createdAt,
    updatedAt,
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_idx").on(table.userId),
    index("session_expiry_idx").on(table.expiresAt),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    uniqueIndex("account_provider_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifier),
    index("verification_expiry_idx").on(table.expiresAt),
  ],
);

export const nflGames = sqliteTable(
  "nfl_games",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week"),
    seasonType: text("season_type").notNull().default("REG"),
    kickoffAt: integer("kickoff_at", { mode: "timestamp" }).notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    status: text("status").notNull().default("scheduled"),
    stadium: text("stadium"),
    roof: text("roof"),
    surface: text("surface"),
    espnEventId: text("espn_event_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("nfl_games_kickoff_idx").on(table.kickoffAt),
    index("nfl_games_status_idx").on(table.status),
    index("nfl_games_teams_idx").on(table.homeTeam, table.awayTeam),
  ],
);

export const nflPlayers = sqliteTable(
  "nfl_players",
  {
    id: text("id").primaryKey(),
    gsisId: text("gsis_id"),
    fullName: text("full_name").notNull(),
    position: text("position"),
    team: text("team"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("nfl_players_gsis_unique").on(table.gsisId),
    index("nfl_players_name_idx").on(table.fullName),
    index("nfl_players_team_idx").on(table.team),
  ],
);

export const playerGameStats = sqliteTable(
  "player_game_stats",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => nflGames.id, { onDelete: "cascade" }),
    team: text("team").notNull(),
    opponent: text("opponent").notNull(),
    passingYards: real("passing_yards"),
    passingAttempts: real("passing_attempts"),
    passingTouchdowns: real("passing_touchdowns"),
    passingInterceptions: real("passing_interceptions"),
    rushingYards: real("rushing_yards"),
    rushingAttempts: real("rushing_attempts"),
    rushingTouchdowns: real("rushing_touchdowns"),
    receivingYards: real("receiving_yards"),
    targets: real("targets"),
    receptions: real("receptions"),
    receivingTouchdowns: real("receiving_touchdowns"),
    fantasyPoints: real("fantasy_points"),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.playerId, table.gameId] }),
    index("player_stats_game_idx").on(table.gameId),
  ],
);

export const marketEvents = sqliteTable(
  "market_events",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id").references(() => nflGames.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    status: text("status").notNull().default("open"),
    homeTeam: text("home_team"),
    awayTeam: text("away_team"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("market_events_game_idx").on(table.gameId),
    index("market_events_status_idx").on(table.status, table.startsAt),
  ],
);

export const normalizedMarkets = sqliteTable(
  "normalized_markets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => marketEvents.id, { onDelete: "cascade" }),
    gameId: text("game_id").references(() => nflGames.id, {
      onDelete: "set null",
    }),
    playerId: text("player_id").references(() => nflPlayers.id, {
      onDelete: "set null",
    }),
    league: text("league").notNull().default("NFL"),
    family: text("family").notNull(),
    statistic: text("statistic"),
    direction: text("direction").notNull(),
    threshold: real("threshold"),
    outcomeLabel: text("outcome_label").notNull(),
    resolutionKey: text("resolution_key").notNull(),
    settlementAt: integer("settlement_at", { mode: "timestamp" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("normalized_market_resolution_unique").on(table.resolutionKey),
    index("normalized_market_game_idx").on(table.gameId),
    index("normalized_market_player_idx").on(table.playerId),
    index("normalized_market_family_idx").on(table.family, table.statistic),
  ],
);

export const marketListings = sqliteTable(
  "market_listings",
  {
    id: text("id").primaryKey(),
    normalizedMarketId: text("normalized_market_id").references(
      () => normalizedMarkets.id,
      { onDelete: "set null" },
    ),
    platform: text("platform").notNull(),
    platformMarketId: text("platform_market_id").notNull(),
    platformOutcomeId: text("platform_outcome_id"),
    eventTitle: text("event_title").notNull(),
    marketTitle: text("market_title").notNull(),
    outcomeLabel: text("outcome_label").notNull(),
    resolutionRules: text("resolution_rules"),
    status: text("status").notNull(),
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(false),
    yesBidBps: integer("yes_bid_bps"),
    yesAskBps: integer("yes_ask_bps"),
    noBidBps: integer("no_bid_bps"),
    noAskBps: integer("no_ask_bps"),
    lastPriceBps: integer("last_price_bps"),
    liquidityCents: integer("liquidity_cents"),
    volumeCents: integer("volume_cents"),
    closesAt: integer("closes_at", { mode: "timestamp" }),
    sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp" }).notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    rawPayload: text("raw_payload", { mode: "json" }).$type<Record<
      string,
      unknown
    >>(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("market_listing_platform_unique").on(
      table.platform,
      table.platformMarketId,
      table.platformOutcomeId,
    ),
    index("market_listing_open_idx").on(table.status, table.fetchedAt),
    index("market_listing_normalized_idx").on(table.normalizedMarketId),
    index("market_listing_platform_idx").on(table.platform, table.isLive),
  ],
);

export const marketPriceSnapshots = sqliteTable(
  "market_price_snapshots",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => marketListings.id, { onDelete: "cascade" }),
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
    yesBidBps: integer("yes_bid_bps"),
    yesAskBps: integer("yes_ask_bps"),
    noBidBps: integer("no_bid_bps"),
    noAskBps: integer("no_ask_bps"),
    liquidityCents: integer("liquidity_cents"),
    volumeCents: integer("volume_cents"),
  },
  (table) => [
    index("price_snapshot_listing_time_idx").on(
      table.listingId,
      table.capturedAt,
    ),
  ],
);

export const modelVersions = sqliteTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    family: text("family").notNull(),
    coefficients: text("coefficients", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull(),
    trainingWindowStart: integer("training_window_start", { mode: "timestamp" }),
    trainingWindowEnd: integer("training_window_end", { mode: "timestamp" }),
    brierScore: real("brier_score"),
    logLoss: real("log_loss"),
    calibrationNotes: text("calibration_notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    createdAt,
  },
  (table) => [
    uniqueIndex("model_version_unique").on(table.name, table.version),
    index("model_active_family_idx").on(table.active, table.family),
  ],
);

export const predictions = sqliteTable(
  "predictions",
  {
    id: text("id").primaryKey(),
    normalizedMarketId: text("normalized_market_id")
      .notNull()
      .references(() => normalizedMarkets.id, { onDelete: "restrict" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => marketListings.id, { onDelete: "restrict" }),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id, { onDelete: "restrict" }),
    predictedProbabilityBps: integer("predicted_probability_bps").notNull(),
    executablePriceBps: integer("executable_price_bps").notNull(),
    edgeBps: integer("edge_bps").notNull(),
    reliabilityBps: integer("reliability_bps").notNull(),
    opportunityScore: real("opportunity_score").notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    features: text("features", { mode: "json" })
      .$type<Record<string, number | string | boolean | null>>()
      .notNull(),
    explanation: text("explanation", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    predictedAt: integer("predicted_at", { mode: "timestamp" }).notNull(),
    createdAt,
  },
  (table) => [
    index("predictions_market_time_idx").on(
      table.normalizedMarketId,
      table.predictedAt,
    ),
    index("predictions_ranking_idx").on(
      table.opportunityScore,
      table.predictedAt,
    ),
  ],
);

export const predictionResults = sqliteTable(
  "prediction_results",
  {
    predictionId: text("prediction_id")
      .primaryKey()
      .references(() => predictions.id, { onDelete: "restrict" }),
    outcome: integer("outcome").notNull(),
    settledAt: integer("settled_at", { mode: "timestamp" }).notNull(),
    settlementSource: text("settlement_source").notNull(),
    brierContribution: real("brier_contribution").notNull(),
    logLossContribution: real("log_loss_contribution").notNull(),
    createdAt,
  },
  (table) => [index("prediction_results_settled_idx").on(table.settledAt)],
);

export const sourceProjections = sqliteTable(
  "source_projections",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerName: text("player_name").notNull(),
    playerKey: text("player_key").notNull(),
    statistic: text("statistic").notNull(),
    source: text("source").notNull(),
    projectedValue: real("projected_value").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("source_projection_unique").on(
      table.season,
      table.week,
      table.playerKey,
      table.statistic,
      table.source,
    ),
    index("source_projection_stat_week_idx").on(
      table.season,
      table.week,
      table.statistic,
    ),
  ],
);

export const sourceProjectionGrades = sqliteTable(
  "source_projection_grades",
  {
    projectionId: text("projection_id")
      .primaryKey()
      .references(() => sourceProjections.id, { onDelete: "cascade" }),
    actualValue: real("actual_value").notNull(),
    absoluteError: real("absolute_error").notNull(),
    squaredError: real("squared_error").notNull(),
    gradedAt: integer("graded_at", { mode: "timestamp" }).notNull(),
    createdAt,
  },
  (table) => [
    index("source_projection_grades_time_idx").on(table.gradedAt),
  ],
);

export const sourceWeightHistory = sqliteTable(
  "source_weight_history",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    effectiveWeek: integer("effective_week").notNull(),
    statistic: text("statistic").notNull(),
    source: text("source").notNull(),
    weight: real("weight").notNull(),
    sampleSize: integer("sample_size").notNull(),
    mae: real("mae"),
    recentMae: real("recent_mae"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("source_weight_unique").on(
      table.season,
      table.effectiveWeek,
      table.statistic,
      table.source,
    ),
    index("source_weight_lookup_idx").on(
      table.season,
      table.statistic,
      table.effectiveWeek,
    ),
  ],
);

export const weatherSnapshots = sqliteTable(
  "weather_snapshots",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => nflGames.id, { onDelete: "cascade" }),
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
    forecastFor: integer("forecast_for", { mode: "timestamp" }).notNull(),
    temperatureF: real("temperature_f"),
    windMph: real("wind_mph"),
    precipitationProbability: real("precipitation_probability"),
    weatherCode: integer("weather_code"),
    severe: integer("severe", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull().default("open-meteo"),
    createdAt,
  },
  (table) => [
    index("weather_game_forecast_idx").on(table.gameId, table.forecastFor),
  ],
);

export const userPositions = sqliteTable(
  "user_positions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    placedAt: integer("placed_at", { mode: "timestamp" }).notNull(),
    platform: text("platform").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    stakeCents: integer("stake_cents").notNull(),
    entryPriceBps: integer("entry_price_bps"),
    status: text("status").notNull(),
    payoutCents: integer("payout_cents"),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("user_positions_user_date_idx").on(table.userId, table.placedAt),
    index("user_positions_user_status_idx").on(table.userId, table.status),
    index("user_positions_user_platform_idx").on(
      table.userId,
      table.platform,
    ),
  ],
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"),
  defaultPlatform: text("default_platform"),
  createdAt,
  updatedAt,
});

export const sourceHealth = sqliteTable(
  "source_health",
  {
    provider: text("provider").primaryKey(),
    status: text("status").notNull(),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
    lastFailureAt: integer("last_failure_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    latencyMs: integer("latency_ms"),
    updatedAt,
  },
  (table) => [index("source_health_status_idx").on(table.status)],
);

export type UserPosition = typeof userPositions.$inferSelect;
export type NewUserPosition = typeof userPositions.$inferInsert;
export type MarketListingRecord = typeof marketListings.$inferSelect;
