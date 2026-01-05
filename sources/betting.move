module suibets::betting {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::types;
    
    use sbets_token::sbets::SBETS;

    // Error codes
    const EInsufficientBalance: u64 = 0;
    const EBetAlreadySettled: u64 = 1;
    const EUnauthorized: u64 = 2;
    const EInvalidOdds: u64 = 3;
    const EBetNotFound: u64 = 4;
    const EEventNotFinished: u64 = 5;
    const EInvalidAmount: u64 = 6;
    const EPlatformPaused: u64 = 7;
    const EExceedsMaxBet: u64 = 8;
    const EExceedsMinBet: u64 = 9;
    const ENotOneTimeWitness: u64 = 10;

    // Bet status constants
    const STATUS_PENDING: u8 = 0;
    const STATUS_WON: u8 = 1;
    const STATUS_LOST: u8 = 2;
    const STATUS_VOID: u8 = 3;

    // Coin type constants for bet tracking
    const COIN_TYPE_SUI: u8 = 0;
    const COIN_TYPE_SBETS: u8 = 1;

    // Platform configuration (1% fee = 100 basis points)
    const PLATFORM_FEE_BPS: u64 = 100;
    const BPS_DENOMINATOR: u64 = 10000;

    // Default bet limits for SUI (in MIST: 1 SUI = 1_000_000_000)
    const DEFAULT_MIN_BET_SUI: u64 = 50_000_000; // 0.05 SUI
    const DEFAULT_MAX_BET_SUI: u64 = 400_000_000_000; // 400 SUI
    // Default bet limits for SBETS (in smallest units: 1 SBETS = 1_000_000_000)
    const DEFAULT_MIN_BET_SBETS: u64 = 1_000_000_000_000; // 1000 SBETS
    const DEFAULT_MAX_BET_SBETS: u64 = 50_000_000_000_000_000; // 50,000,000 SBETS
    const MAX_FEE_BPS: u64 = 1000; // 10% max fee

    // One-Time Witness for init verification
    public struct BETTING has drop {}

    // Admin capability - only one exists, minted during init
    public struct AdminCap has key, store {
        id: UID,
    }

    // Oracle capability - can be minted by admin for settlement oracles
    public struct OracleCap has key, store {
        id: UID,
    }

    // Betting platform shared object with dual treasury (SUI + SBETS)
    public struct BettingPlatform has key {
        id: UID,
        // SUI treasury
        treasury_sui: Balance<SUI>,
        total_volume_sui: u64,
        total_potential_liability_sui: u64,
        accrued_fees_sui: u64,
        // SBETS treasury
        treasury_sbets: Balance<SBETS>,
        total_volume_sbets: u64,
        total_potential_liability_sbets: u64,
        accrued_fees_sbets: u64,
        // Shared settings
        platform_fee_bps: u64,
        total_bets: u64,
        paused: bool,
        // Separate bet limits for SUI and SBETS
        min_bet_sui: u64,
        max_bet_sui: u64,
        min_bet_sbets: u64,
        max_bet_sbets: u64,
    }

    // Individual bet object owned by bettor
    public struct Bet has key, store {
        id: UID,
        bettor: address,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        stake: u64,
        potential_payout: u64,
        platform_fee: u64,
        status: u8,
        placed_at: u64,
        settled_at: u64,
        walrus_blob_id: vector<u8>,
        coin_type: u8,
    }

    // Events
    public struct BetPlaced has copy, drop {
        bet_id: ID,
        bettor: address,
        event_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        stake: u64,
        potential_payout: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct BetSettled has copy, drop {
        bet_id: ID,
        bettor: address,
        status: u8,
        payout: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct PlatformCreated has copy, drop {
        platform_id: ID,
        admin_cap_id: ID,
        fee_bps: u64,
    }

    public struct PlatformPaused has copy, drop {
        platform_id: ID,
        paused: bool,
        timestamp: u64,
    }

    public struct OracleCapMinted has copy, drop {
        oracle_cap_id: ID,
        recipient: address,
        timestamp: u64,
    }

    public struct OracleCapRevoked has copy, drop {
        oracle_cap_id: ID,
        timestamp: u64,
    }

    public struct LiquidityDeposited has copy, drop {
        platform_id: ID,
        depositor: address,
        amount: u64,
        coin_type: u8,
        timestamp: u64,
    }

    public struct FeesWithdrawn has copy, drop {
        platform_id: ID,
        amount: u64,
        coin_type: u8,
        timestamp: u64,
    }

    // Initialize the betting platform with OTW verification
    fun init(witness: BETTING, ctx: &mut TxContext) {
        assert!(types::is_one_time_witness(&witness), ENotOneTimeWitness);
        
        let deployer = tx_context::sender(ctx);
        
        // Create AdminCap for deployer
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        let admin_cap_id = object::id(&admin_cap);
        
        // Create platform with dual treasury
        let platform = BettingPlatform {
            id: object::new(ctx),
            treasury_sui: balance::zero(),
            total_volume_sui: 0,
            total_potential_liability_sui: 0,
            accrued_fees_sui: 0,
            treasury_sbets: balance::zero(),
            total_volume_sbets: 0,
            total_potential_liability_sbets: 0,
            accrued_fees_sbets: 0,
            platform_fee_bps: PLATFORM_FEE_BPS,
            total_bets: 0,
            paused: false,
            min_bet_sui: DEFAULT_MIN_BET_SUI,
            max_bet_sui: DEFAULT_MAX_BET_SUI,
            min_bet_sbets: DEFAULT_MIN_BET_SBETS,
            max_bet_sbets: DEFAULT_MAX_BET_SBETS,
        };

        event::emit(PlatformCreated {
            platform_id: object::id(&platform),
            admin_cap_id,
            fee_bps: PLATFORM_FEE_BPS,
        });

        // Share platform, transfer AdminCap to deployer
        transfer::share_object(platform);
        transfer::transfer(admin_cap, deployer);
    }

    // ============ SUI BETTING ============

    // Place a bet with SUI (anyone can call)
    public entry fun place_bet(
        platform: &mut BettingPlatform,
        payment: Coin<SUI>,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!platform.paused, EPlatformPaused);
        
        let stake = coin::value(&payment);
        assert!(stake > 0, EInvalidAmount);
        assert!(stake >= platform.min_bet_sui, EExceedsMinBet);
        assert!(stake <= platform.max_bet_sui, EExceedsMaxBet);
        assert!(odds >= 100, EInvalidOdds);

        let potential_payout = (stake * odds) / 100;
        
        let current_treasury = balance::value(&platform.treasury_sui);
        assert!(
            current_treasury + stake >= platform.total_potential_liability_sui + potential_payout,
            EInsufficientBalance
        );

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut platform.treasury_sui, payment_balance);

        platform.total_bets = platform.total_bets + 1;
        platform.total_volume_sui = platform.total_volume_sui + stake;
        platform.total_potential_liability_sui = platform.total_potential_liability_sui + potential_payout;

        let bettor = tx_context::sender(ctx);
        let timestamp = clock::timestamp_ms(clock);

        let bet = Bet {
            id: object::new(ctx),
            bettor,
            event_id,
            market_id,
            prediction,
            odds,
            stake,
            potential_payout,
            platform_fee: 0,
            status: STATUS_PENDING,
            placed_at: timestamp,
            settled_at: 0,
            walrus_blob_id,
            coin_type: COIN_TYPE_SUI,
        };

        let bet_id = object::id(&bet);

        event::emit(BetPlaced {
            bet_id,
            bettor,
            event_id: bet.event_id,
            prediction: bet.prediction,
            odds,
            stake,
            potential_payout,
            coin_type: COIN_TYPE_SUI,
            timestamp,
        });

        transfer::transfer(bet, bettor);
    }

    // Settle a SUI bet (requires OracleCap)
    public entry fun settle_bet(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sui = platform.accrued_fees_sui + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sui) >= net_payout, EInsufficientBalance);
            
            let payout_balance = balance::split(&mut platform.treasury_sui, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sui = platform.accrued_fees_sui + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        }
    }

    // Settle a SUI bet with AdminCap
    public entry fun settle_bet_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sui = platform.accrued_fees_sui + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sui) >= net_payout, EInsufficientBalance);
            
            let payout_balance = balance::split(&mut platform.treasury_sui, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sui = platform.accrued_fees_sui + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SUI,
                timestamp,
            });
        }
    }

    // Void a SUI bet (requires OracleCap)
    public entry fun void_bet(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        let refund_amount = bet.stake;
        
        if (balance::value(&platform.treasury_sui) >= refund_amount) {
            let refund_balance = balance::split(&mut platform.treasury_sui, refund_amount);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, bet.bettor);
        };

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: bet.settled_at,
        });
    }

    // Void a SUI bet with AdminCap
    public entry fun void_bet_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SUI, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sui = platform.total_potential_liability_sui - bet.potential_payout;

        let refund_amount = bet.stake;
        
        if (balance::value(&platform.treasury_sui) >= refund_amount) {
            let refund_balance = balance::split(&mut platform.treasury_sui, refund_amount);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, bet.bettor);
        };

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: bet.settled_at,
        });
    }

    // ============ SBETS BETTING ============

    // Place a bet with SBETS (anyone can call)
    public entry fun place_bet_sbets(
        platform: &mut BettingPlatform,
        payment: Coin<SBETS>,
        event_id: vector<u8>,
        market_id: vector<u8>,
        prediction: vector<u8>,
        odds: u64,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!platform.paused, EPlatformPaused);
        
        let stake = coin::value(&payment);
        assert!(stake > 0, EInvalidAmount);
        assert!(stake >= platform.min_bet_sbets, EExceedsMinBet);
        assert!(stake <= platform.max_bet_sbets, EExceedsMaxBet);
        assert!(odds >= 100, EInvalidOdds);

        let potential_payout = (stake * odds) / 100;
        
        let current_treasury = balance::value(&platform.treasury_sbets);
        assert!(
            current_treasury + stake >= platform.total_potential_liability_sbets + potential_payout,
            EInsufficientBalance
        );

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut platform.treasury_sbets, payment_balance);

        platform.total_bets = platform.total_bets + 1;
        platform.total_volume_sbets = platform.total_volume_sbets + stake;
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets + potential_payout;

        let bettor = tx_context::sender(ctx);
        let timestamp = clock::timestamp_ms(clock);

        let bet = Bet {
            id: object::new(ctx),
            bettor,
            event_id,
            market_id,
            prediction,
            odds,
            stake,
            potential_payout,
            platform_fee: 0,
            status: STATUS_PENDING,
            placed_at: timestamp,
            settled_at: 0,
            walrus_blob_id,
            coin_type: COIN_TYPE_SBETS,
        };

        let bet_id = object::id(&bet);

        event::emit(BetPlaced {
            bet_id,
            bettor,
            event_id: bet.event_id,
            prediction: bet.prediction,
            odds,
            stake,
            potential_payout,
            coin_type: COIN_TYPE_SBETS,
            timestamp,
        });

        transfer::transfer(bet, bettor);
    }

    // Settle a SBETS bet (requires OracleCap)
    public entry fun settle_bet_sbets(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sbets) >= net_payout, EInsufficientBalance);
            
            let payout_balance = balance::split(&mut platform.treasury_sbets, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        }
    }

    // Settle a SBETS bet with AdminCap
    public entry fun settle_bet_sbets_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        won: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        let timestamp = clock::timestamp_ms(clock);
        bet.settled_at = timestamp;
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        if (won) {
            bet.status = STATUS_WON;
            
            let profit = bet.potential_payout - bet.stake;
            let win_fee = (profit * platform.platform_fee_bps) / BPS_DENOMINATOR;
            let net_payout = bet.potential_payout - win_fee;
            
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + win_fee;
            bet.platform_fee = win_fee;
            
            assert!(balance::value(&platform.treasury_sbets) >= net_payout, EInsufficientBalance);
            
            let payout_balance = balance::split(&mut platform.treasury_sbets, net_payout);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, bet.bettor);

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_WON,
                payout: net_payout,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        } else {
            bet.status = STATUS_LOST;
            platform.accrued_fees_sbets = platform.accrued_fees_sbets + bet.stake;

            event::emit(BetSettled {
                bet_id: object::id(bet),
                bettor: bet.bettor,
                status: STATUS_LOST,
                payout: 0,
                coin_type: COIN_TYPE_SBETS,
                timestamp,
            });
        }
    }

    // Void a SBETS bet (requires OracleCap)
    public entry fun void_bet_sbets(
        _oracle_cap: &OracleCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        let refund_amount = bet.stake;
        
        if (balance::value(&platform.treasury_sbets) >= refund_amount) {
            let refund_balance = balance::split(&mut platform.treasury_sbets, refund_amount);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, bet.bettor);
        };

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: bet.settled_at,
        });
    }

    // Void a SBETS bet with AdminCap
    public entry fun void_bet_sbets_admin(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        bet: &mut Bet,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(bet.status == STATUS_PENDING, EBetAlreadySettled);
        assert!(bet.coin_type == COIN_TYPE_SBETS, EInvalidAmount);

        bet.status = STATUS_VOID;
        bet.settled_at = clock::timestamp_ms(clock);
        
        platform.total_potential_liability_sbets = platform.total_potential_liability_sbets - bet.potential_payout;

        let refund_amount = bet.stake;
        
        if (balance::value(&platform.treasury_sbets) >= refund_amount) {
            let refund_balance = balance::split(&mut platform.treasury_sbets, refund_amount);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, bet.bettor);
        };

        event::emit(BetSettled {
            bet_id: object::id(bet),
            bettor: bet.bettor,
            status: STATUS_VOID,
            payout: refund_amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: bet.settled_at,
        });
    }

    // ============ ADMIN FUNCTIONS ============
    
    // Deposit liquidity to the platform (SUI)
    public entry fun deposit_liquidity(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        coin: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&coin);
        balance::join(&mut platform.treasury_sui, coin::into_balance(coin));
        
        event::emit(LiquidityDeposited {
            platform_id: object::id(platform),
            depositor: tx_context::sender(ctx),
            amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // Deposit liquidity to the platform (SBETS)
    public entry fun deposit_liquidity_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        coin: Coin<SBETS>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&coin);
        balance::join(&mut platform.treasury_sbets, coin::into_balance(coin));
        
        event::emit(LiquidityDeposited {
            platform_id: object::id(platform),
            depositor: tx_context::sender(ctx),
            amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // Withdraw accrued fees (SUI)
    public entry fun withdraw_fees(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(amount <= platform.accrued_fees_sui, EInsufficientBalance);
        
        let fees_balance = balance::split(&mut platform.treasury_sui, amount);
        let fees_coin = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, tx_context::sender(ctx));
        
        platform.accrued_fees_sui = platform.accrued_fees_sui - amount;

        event::emit(FeesWithdrawn {
            platform_id: object::id(platform),
            amount,
            coin_type: COIN_TYPE_SUI,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // Withdraw accrued fees (SBETS)
    public entry fun withdraw_fees_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(amount <= platform.accrued_fees_sbets, EInsufficientBalance);
        
        let fees_balance = balance::split(&mut platform.treasury_sbets, amount);
        let fees_coin = coin::from_balance(fees_balance, ctx);
        transfer::public_transfer(fees_coin, tx_context::sender(ctx));
        
        platform.accrued_fees_sbets = platform.accrued_fees_sbets - amount;

        event::emit(FeesWithdrawn {
            platform_id: object::id(platform),
            amount,
            coin_type: COIN_TYPE_SBETS,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // Update platform fee
    public entry fun update_fee(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= MAX_FEE_BPS, EUnauthorized);
        platform.platform_fee_bps = new_fee_bps;
    }

    // Update bet limits for SUI
    public entry fun update_limits_sui(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        min_bet: u64,
        max_bet: u64,
    ) {
        platform.min_bet_sui = min_bet;
        platform.max_bet_sui = max_bet;
    }

    // Update bet limits for SBETS
    public entry fun update_limits_sbets(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        min_bet: u64,
        max_bet: u64,
    ) {
        platform.min_bet_sbets = min_bet;
        platform.max_bet_sbets = max_bet;
    }

    // Pause/Unpause platform
    public entry fun toggle_pause(
        _admin_cap: &AdminCap,
        platform: &mut BettingPlatform,
        clock: &Clock,
    ) {
        platform.paused = !platform.paused;
        
        event::emit(PlatformPaused {
            platform_id: object::id(platform),
            paused: platform.paused,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // Mint OracleCap
    public entry fun mint_oracle_cap(
        _admin_cap: &AdminCap,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let oracle_cap = OracleCap {
            id: object::new(ctx),
        };
        
        event::emit(OracleCapMinted {
            oracle_cap_id: object::id(&oracle_cap),
            recipient,
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(oracle_cap, recipient);
    }

    // Revoke OracleCap
    public entry fun revoke_oracle_cap(
        _admin_cap: &AdminCap,
        oracle_cap: OracleCap,
        clock: &Clock,
    ) {
        let oracle_cap_id = object::id(&oracle_cap);
        let OracleCap { id } = oracle_cap;
        object::delete(id);

        event::emit(OracleCapRevoked {
            oracle_cap_id,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // ============ VIEW FUNCTIONS ============

    public fun get_platform_stats(platform: &BettingPlatform): (u64, u64, u64, u64, u64, bool) {
        (
            platform.total_bets,
            platform.total_volume_sui,
            platform.total_volume_sbets,
            balance::value(&platform.treasury_sui),
            balance::value(&platform.treasury_sbets),
            platform.paused
        )
    }

    public fun get_bet_info(bet: &Bet): (address, u64, u64, u8, u8) {
        (bet.bettor, bet.stake, bet.odds, bet.status, bet.coin_type)
    }
}
