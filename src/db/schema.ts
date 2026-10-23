import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  integer,
  primaryKey,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .default(sql`now()`);
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .default(sql`now()`)
  .$onUpdate(() => new Date());

// Better Auth core tables. Property names intentionally follow Better Auth's
// adapter contract while SQL names remain conventional snake_case.
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified")
      .notNull()
      .default(false),
    image: text("image"),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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

export const account = pgTable(
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
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
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

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifier),
    index("verification_expiry_idx").on(table.expiresAt),
  ],
);

export const nflGames = pgTable(
  "nfl_games",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week"),
    seasonType: text("season_type").notNull().default("REG"),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
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

export const nflPlayers = pgTable(
  "nfl_players",
  {
    id: text("id").primaryKey(),
    gsisId: text("gsis_id"),
    fullName: text("full_name").notNull(),
    position: text("position"),
    team: text("team"),
    active: boolean("active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("nfl_players_gsis_unique").on(table.gsisId),
    index("nfl_players_name_idx").on(table.fullName),
    index("nfl_players_team_idx").on(table.team),
  ],
);

export const playerGameStats = pgTable(
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
    passingYards: doublePrecision("passing_yards"),
    passingAttempts: doublePrecision("passing_attempts"),
    passingTouchdowns: doublePrecision("passing_touchdowns"),
    passingInterceptions: doublePrecision("passing_interceptions"),
    rushingYards: doublePrecision("rushing_yards"),
    rushingAttempts: doublePrecision("rushing_attempts"),
    rushingTouchdowns: doublePrecision("rushing_touchdowns"),
    receivingYards: doublePrecision("receiving_yards"),
    targets: doublePrecision("targets"),
    receptions: doublePrecision("receptions"),
    receivingTouchdowns: doublePrecision("receiving_touchdowns"),
    fantasyPoints: doublePrecision("fantasy_points"),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.playerId, table.gameId] }),
    index("player_stats_game_idx").on(table.gameId),
  ],
);

export const marketEvents = pgTable(
  "market_events",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id").references(() => nflGames.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
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

export const normalizedMarkets = pgTable(
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
    threshold: doublePrecision("threshold"),
    outcomeLabel: text("outcome_label").notNull(),
    resolutionKey: text("resolution_key").notNull(),
    settlementAt: timestamp("settlement_at", { withTimezone: true }),
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

export const marketListings = pgTable(
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
    isLive: boolean("is_live").notNull().default(false),
    yesBidBps: integer("yes_bid_bps"),
    yesAskBps: integer("yes_ask_bps"),
    noBidBps: integer("no_bid_bps"),
    noAskBps: integer("no_ask_bps"),
    lastPriceBps: integer("last_price_bps"),
    liquidityCents: integer("liquidity_cents"),
    volumeCents: integer("volume_cents"),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<
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

export const marketPriceSnapshots = pgTable(
  "market_price_snapshots",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => marketListings.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
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

export const modelVersions = pgTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    family: text("family").notNull(),
    coefficients: jsonb("coefficients")
      .$type<Record<string, number>>()
      .notNull(),
    trainingWindowStart: timestamp("training_window_start", { withTimezone: true }),
    trainingWindowEnd: timestamp("training_window_end", { withTimezone: true }),
    brierScore: doublePrecision("brier_score"),
    logLoss: doublePrecision("log_loss"),
    calibrationNotes: text("calibration_notes"),
    active: boolean("active").notNull().default(false),
    createdAt,
  },
  (table) => [
    uniqueIndex("model_version_unique").on(table.name, table.version),
    index("model_active_family_idx").on(table.active, table.family),
  ],
);

export const predictions = pgTable(
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
    opportunityScore: doublePrecision("opportunity_score").notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    features: jsonb("features")
      .$type<Record<string, number | string | boolean | null>>()
      .notNull(),
    explanation: jsonb("explanation")
      .$type<string[]>()
      .notNull(),
    predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    index("predictions_market_time_idx").on(
      table.normalizedMarketId,
      table.predictedAt,
    ),
    index("predictions_time_idx").on(table.predictedAt),
    index("predictions_ranking_idx").on(
      table.opportunityScore,
      table.predictedAt,
    ),
  ],
);

export const predictionResults = pgTable(
  "prediction_results",
  {
    predictionId: text("prediction_id")
      .primaryKey()
      .references(() => predictions.id, { onDelete: "restrict" }),
    outcome: integer("outcome").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    settlementSource: text("settlement_source").notNull(),
    brierContribution: doublePrecision("brier_contribution").notNull(),
    logLossContribution: doublePrecision("log_loss_contribution").notNull(),
    createdAt,
  },
  (table) => [index("prediction_results_settled_idx").on(table.settledAt)],
);

export const weeklyScorecardPicks = pgTable(
  "weekly_scorecard_picks",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    rank: integer("rank").notNull(),
    bucket: text("bucket"),
    bucketRank: integer("bucket_rank"),
    predictionId: text("prediction_id")
      .notNull()
      .references(() => predictions.id, { onDelete: "restrict" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("weekly_scorecard_week_rank_unique").on(
      table.season,
      table.week,
      table.rank,
    ),
    uniqueIndex("weekly_scorecard_bucket_rank_unique").on(
      table.season,
      table.week,
      table.bucket,
      table.bucketRank,
    ),
    uniqueIndex("weekly_scorecard_prediction_unique").on(table.predictionId),
    index("weekly_scorecard_week_idx").on(table.season, table.week),
  ],
);

export const sourceProjections = pgTable(
  "source_projections",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerName: text("player_name").notNull(),
    playerKey: text("player_key").notNull(),
    statistic: text("statistic").notNull(),
    source: text("source").notNull(),
    projectedValue: doublePrecision("projected_value").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    latestProjectedValue: doublePrecision("latest_projected_value"),
    latestCapturedAt: timestamp("latest_captured_at", { withTimezone: true }),
    observationCount: integer("observation_count").notNull().default(1),
    provenance: text("provenance").notNull().default("live_capture"),
    learningEligible: boolean("learning_eligible")
      .notNull()
      .default(true),
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

export const sourceProjectionGrades = pgTable(
  "source_projection_grades",
  {
    projectionId: text("projection_id")
      .primaryKey()
      .references(() => sourceProjections.id, { onDelete: "cascade" }),
    actualValue: doublePrecision("actual_value").notNull(),
    absoluteError: doublePrecision("absolute_error").notNull(),
    squaredError: doublePrecision("squared_error").notNull(),
    gradedAt: timestamp("graded_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    index("source_projection_grades_time_idx").on(table.gradedAt),
  ],
);

export const sourceWeightHistory = pgTable(
  "source_weight_history",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    effectiveWeek: integer("effective_week").notNull(),
    statistic: text("statistic").notNull(),
    source: text("source").notNull(),
    weight: doublePrecision("weight").notNull(),
    sampleSize: integer("sample_size").notNull(),
    mae: doublePrecision("mae"),
    recentMae: doublePrecision("recent_mae"),
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

export const moneylineSourceWeightHistory = pgTable(
  "moneyline_source_weight_history",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    effectiveWeek: integer("effective_week").notNull(),
    source: text("source").notNull(),
    weight: doublePrecision("weight").notNull(),
    priorWeight: doublePrecision("prior_weight").notNull(),
    sampleSize: integer("sample_size").notNull(),
    brierScore: doublePrecision("brier_score"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("moneyline_source_weight_unique").on(
      table.season,
      table.effectiveWeek,
      table.source,
    ),
    index("moneyline_source_weight_lookup_idx").on(
      table.season,
      table.effectiveWeek,
    ),
  ],
);

export const weatherSnapshots = pgTable(
  "weather_snapshots",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => nflGames.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    forecastFor: timestamp("forecast_for", { withTimezone: true }).notNull(),
    temperatureF: doublePrecision("temperature_f"),
    windMph: doublePrecision("wind_mph"),
    precipitationProbability: doublePrecision("precipitation_probability"),
    weatherCode: integer("weather_code"),
    severe: boolean("severe").notNull().default(false),
    source: text("source").notNull().default("open-meteo"),
    createdAt,
  },
  (table) => [
    index("weather_game_forecast_idx").on(table.gameId, table.forecastFor),
  ],
);

export const userPositions = pgTable(
  "user_positions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
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

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"),
  defaultPlatform: text("default_platform"),
  createdAt,
  updatedAt,
});

export const sourceHealth = pgTable(
  "source_health",
  {
    provider: text("provider").primaryKey(),
    status: text("status").notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastError: text("last_error"),
    latencyMs: integer("latency_ms"),
    updatedAt,
  },
  (table) => [index("source_health_status_idx").on(table.status)],
);

export type UserPosition = typeof userPositions.$inferSelect;
export type NewUserPosition = typeof userPositions.$inferInsert;
export type MarketListingRecord = typeof marketListings.$inferSelect;
