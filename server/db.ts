import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@shared/schema';

// Database connection string from environment variables
const connectionString = process.env.DATABASE_URL;

// Declare variables that will be initialized properly
let client: any;
let db: any;

// Check if the connection string is defined
if (!connectionString) {
  console.warn('DATABASE_URL environment variable is not defined');
  console.warn('Blockchain storage will be used as a fallback');
  
  // Set placeholders for the db objects
  client = null;
  db = {
    select: () => ({ from: () => Promise.resolve([]) }),
    insert: () => ({ values: () => Promise.resolve([]) })
  };
} else {
  // Create the database connection
  client = postgres(connectionString, { max: 10 });
  
  // Create the database
  db = drizzle(client, { schema });
}

// Export the database
export { db };

/**
 * Initialize the database (create tables, run migrations, etc.)
 */
export async function initDb() {
  try {
    // If no database connection, return early
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping database initialization');
      return db;
    }
    
    console.log('Connecting to database...');
    
    // Run automatic schema migrations
    await runAutoMigrations();
    
    console.log('Database connection established');
    return db;
  } catch (error) {
    console.error('Error initializing database:', error);
    // Don't throw error, just log it and continue
    console.log('Continuing with blockchain-based storage as fallback');
    return db;
  }
}

/**
 * Run automatic migrations to add missing columns
 */
async function runAutoMigrations() {
  if (!client) return;
  
  try {
    console.log('Checking for schema updates...');
    
    // Add currency column to bets table if it doesn't exist
    await client`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'bets' AND column_name = 'currency'
        ) THEN
          ALTER TABLE bets ADD COLUMN currency VARCHAR(10) DEFAULT 'SUI';
          RAISE NOTICE 'Added currency column to bets table';
        END IF;
      END $$;
    `;
    
    console.log('Schema check complete');
  } catch (error) {
    console.error('Auto-migration error (non-fatal):', error);
  }
}

/**
 * Seed the database with initial data
 */
export async function seedDb() {
  try {
    // If no database connection, return early
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping database seeding');
      return;
    }
    
    console.log('Seeding database...');
    
    // Seed sports data
    await seedSports();
    
    // Seed market types data
    await seedMarketTypes();
    
    // Seed promotions data
    await seedPromotions();
    
    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
    // Don't throw error, just log it
    console.log('Continuing with blockchain-based storage as fallback');
  }
}

/**
 * Seed sports data
 */
async function seedSports() {
  try {
    // Skip if no database connection
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping sports seeding');
      return;
    }
    
    // Check if sports already exist
    const existingSports = await db.select().from(schema.sports);
    
    if (existingSports.length > 0) {
      console.log(`Found ${existingSports.length} existing sports, checking for missing sports...`);
      const existingSlugs = new Set(existingSports.map((s: any) => s.slug));
      const missingSports = [
        { name: 'Horse Racing', slug: 'horse-racing', icon: '🏇', wurlusSportId: 'horse_racing_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
        { name: 'Cricket', slug: 'cricket', icon: '🏏', wurlusSportId: 'cricket_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
        { name: 'Boxing', slug: 'boxing', icon: '🥊', wurlusSportId: 'boxing_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
      ].filter(s => !existingSlugs.has(s.slug));
      if (missingSports.length > 0) {
        await db.insert(schema.sports).values(missingSports);
        console.log(`Added ${missingSports.length} missing sports: ${missingSports.map(s => s.name).join(', ')}`);
      }
      return;
    }
    
    console.log('Seeding sports data...');
    
    // Default sports data
    const sportsData = [
      { 
        name: 'Soccer', 
        slug: 'soccer',
        icon: '⚽',
        wurlusSportId: 'soccer_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Basketball', 
        slug: 'basketball',
        icon: '🏀',
        wurlusSportId: 'basketball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Tennis', 
        slug: 'tennis',
        icon: '🎾',
        wurlusSportId: 'tennis_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'American Football', 
        slug: 'american-football',
        icon: '🏈',
        wurlusSportId: 'football_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Baseball', 
        slug: 'baseball',
        icon: '⚾',
        wurlusSportId: 'baseball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Ice Hockey', 
        slug: 'ice-hockey',
        icon: '🏒',
        wurlusSportId: 'hockey_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'MMA', 
        slug: 'mma',
        icon: '🥊',
        wurlusSportId: 'mma_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_2'
      },
      { 
        name: 'Boxing', 
        slug: 'boxing',
        icon: '🥊',
        wurlusSportId: 'boxing_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_2'
      },
      { 
        name: 'Esports', 
        slug: 'esports',
        icon: '🎮',
        wurlusSportId: 'esports_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_3'
      },
      // New sports from API-Sports
      { 
        name: 'AFL', 
        slug: 'afl',
        icon: '🏉',
        wurlusSportId: 'afl_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Formula 1', 
        slug: 'formula-1',
        icon: '🏎️',
        wurlusSportId: 'f1_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Handball', 
        slug: 'handball',
        icon: '🤾',
        wurlusSportId: 'handball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'NBA', 
        slug: 'nba',
        icon: '🏀',
        wurlusSportId: 'nba_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'NFL', 
        slug: 'nfl',
        icon: '🏈',
        wurlusSportId: 'nfl_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Rugby', 
        slug: 'rugby',
        icon: '🏉',
        wurlusSportId: 'rugby_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Volleyball', 
        slug: 'volleyball',
        icon: '🏐',
        wurlusSportId: 'volleyball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Horse Racing', 
        slug: 'horse-racing',
        icon: '🏇',
        wurlusSportId: 'horse_racing_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      }
    ];
    
    // Insert sports data
    await db.insert(schema.sports).values(sportsData);
    
    console.log(`Seeded ${sportsData.length} sports`);
  } catch (error) {
    console.error('Error seeding sports data:', error);
    console.log('Continuing with blockchain-based storage as fallback');
  }
}

/**
 * Seed market types data
 */
async function seedMarketTypes() {
  try {
    // Skip if no database connection
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping market types seeding');
      return;
    }
    
    // Check if market types already exist
    const existingMarketTypes = await db.select().from(schema.marketTypes);
    
    if (existingMarketTypes.length > 0) {
      console.log(`Found ${existingMarketTypes.length} existing market types, skipping seed`);
      return;
    }
    
    console.log('Seeding market types data...');
    
    // Default market types data
    const marketTypesData = [
      {
        code: "MONEYLINE",
        name: "Money Line",
        description: "Bet on the outcome of a match - home win, draw, or away win",
        category: "main",
        isActive: true,
        displayOrder: 1,
        createdAt: new Date()
      },
      {
        code: "OVER_UNDER",
        name: "Over/Under",
        description: "Bet on whether the total score will be over or under a specified value",
        category: "main",
        isActive: true,
        requiresNumericValue: true,
        displayOrder: 2,
        createdAt: new Date()
      },
      {
        code: "CORRECT_SCORE",
        name: "Correct Score",
        description: "Bet on the exact final score of a match",
        category: "props",
        isActive: true,
        requiresScoreSelection: true,
        displayOrder: 3,
        createdAt: new Date()
      },
      {
        code: "FIRST_SCORER",
        name: "First Scorer",
        description: "Bet on which player will score the first goal/point",
        category: "props",
        isActive: true,
        requiresPlayerSelection: true,
        displayOrder: 4,
        createdAt: new Date()
      },
      {
        code: "HANDICAP",
        name: "Handicap",
        description: "Bet with a handicap applied to the favorite team",
        category: "main",
        isActive: true,
        requiresNumericValue: true,
        displayOrder: 5,
        createdAt: new Date()
      },
      {
        code: "BTTS",
        name: "Both Teams to Score",
        description: "Bet on whether both teams will score in the match",
        category: "main",
        isActive: true,
        displayOrder: 6,
        createdAt: new Date()
      },
      {
        code: "DOUBLE_CHANCE",
        name: "Double Chance",
        description: "Bet on two of three possible outcomes (1X, X2, or 12)",
        category: "main",
        isActive: true,
        displayOrder: 7,
        createdAt: new Date()
      },
      {
        code: "HALF_TIME",
        name: "Half-Time Result",
        description: "Bet on the result at half-time",
        category: "main",
        isActive: true,
        displayOrder: 8,
        createdAt: new Date()
      }
    ];
    
    // Insert market types data
    await db.insert(schema.marketTypes).values(marketTypesData);
    
    console.log(`Seeded ${marketTypesData.length} market types`);
  } catch (error) {
    console.error('Error initializing default data:', error);
    console.log('Continuing with blockchain-based storage as fallback');
  }
}

/**
 * Seed promotions data
 */
async function seedPromotions() {
  try {
    // Skip if no database connection
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping promotions seeding');
      return;
    }
    
    // Check if promotions already exist
    const existingPromotions = await db.select().from(schema.promotions);
    
    if (existingPromotions.length > 0) {
      console.log(`Found ${existingPromotions.length} existing promotions, skipping seed`);
      return;
    }
    
    console.log('Seeding promotions data...');
    
    // Default promotions data
    const promotionsData = [
      {
        title: 'Welcome Bonus',
        description: 'Get 100% bonus on your first deposit up to 1000 SUI',
        type: 'deposit',
        code: 'WELCOME100',
        isActive: true,
        amount: 1000,
        minDeposit: 100,
        maxReward: 1000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        requirements: 'First-time deposit',
        termsAndConditions: 'Must wager bonus amount 10x before withdrawal',
        imageUrl: '/images/welcome-bonus.jpg',
        smartContractAddress: null
      },
      {
        title: 'Refer a Friend',
        description: 'Get 50 SUI for each friend you refer to our platform',
        type: 'referral',
        code: 'REFER50',
        isActive: true,
        amount: 50,
        minDeposit: 0,
        maxReward: 500,
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
        requirements: 'Referred friend must deposit at least 100 SUI',
        termsAndConditions: 'Bonus paid once friend completes first bet',
        imageUrl: '/images/refer-friend.jpg',
        smartContractAddress: null
      },
      {
        title: 'Enhanced Odds',
        description: 'Get enhanced odds on selected Esports matches',
        type: 'odds',
        code: 'ESPORTS',
        isActive: true,
        amount: null,
        minDeposit: 10,
        maxReward: 500,
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        requirements: 'Valid for Esports bets only',
        termsAndConditions: 'Maximum bet amount of 100 SUI per match',
        imageUrl: '/images/enhanced-odds.jpg',
        smartContractAddress: null
      },
      {
        title: 'Loyalty Program',
        description: 'Earn loyalty points for every bet you place',
        type: 'loyalty',
        code: 'LOYALTY',
        isActive: true,
        amount: null,
        minDeposit: 0,
        maxReward: null,
        startDate: new Date(),
        endDate: null, // No end date
        requirements: 'Must have an active account',
        termsAndConditions: 'Points can be redeemed for free bets or merchandise',
        imageUrl: '/images/loyalty.jpg',
        smartContractAddress: null
      },
      {
        title: 'Staking Rewards',
        description: 'Stake SUI tokens and earn weekly rewards',
        type: 'staking',
        code: 'STAKE',
        isActive: true,
        amount: null,
        minDeposit: 500,
        maxReward: null,
        startDate: new Date(),
        endDate: null, // No end date
        requirements: 'Minimum staking period of 30 days',
        termsAndConditions: 'Rewards paid weekly based on staking amount',
        imageUrl: '/images/staking.jpg',
        smartContractAddress: '0xabc123def456sui'
      }
    ];
    
    // Insert promotions data
    await db.insert(schema.promotions).values(promotionsData);
    
    console.log(`Seeded ${promotionsData.length} promotions`);
  } catch (error) {
    console.error('Error seeding promotions data:', error);
    console.log('Continuing with blockchain-based storage as fallback');
  }
}