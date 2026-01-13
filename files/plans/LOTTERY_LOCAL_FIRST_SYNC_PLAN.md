# Lottery Local-First Sync Implementation Plan

**Project:** Nuvana Sync - Lottery Module
**Created:** 2026-01-12
**Last Updated:** 2026-01-12
**Status:** Planning

---

## Executive Summary

This plan outlines the implementation of a local-first lottery management system with cloud synchronization. The lottery module will allow stores to manage lottery games, receive packs, activate them in bins, track sales, and perform day-close operations - all while maintaining offline capability and syncing to the cloud when connected.

---

## Current State Assessment

### Already Implemented (90% Complete)

| Component | Status | Location |
|-----------|--------|----------|
| Database Schema (10 tables) | ✅ Complete | `src/main/migrations/v003_lottery_tables.sql` |
| Lottery Games DAL | ✅ Complete | `src/main/dal/lottery-games.dal.ts` |
| Lottery Bins DAL | ✅ Complete | `src/main/dal/lottery-bins.dal.ts` |
| Lottery Packs DAL | ✅ Complete | `src/main/dal/lottery-packs.dal.ts` |
| Lottery Business Days DAL | ✅ Complete | `src/main/dal/lottery-business-days.dal.ts` |
| IPC Handlers (all endpoints) | ✅ Complete | `src/main/ipc/lottery.handlers.ts` |
| Cloud API Types | ✅ Complete | `src/main/services/cloud-api.service.ts` |
| Cloud Pull Methods | ✅ Complete | `pullGames()`, `pullBins()` in cloud-api.service |
| Renderer Components | ✅ Complete | `src/renderer/components/lottery/*` |
| Renderer Hooks | ✅ Complete | `src/renderer/hooks/useLottery.ts` |

### Missing (10% Remaining)

| Component | Status | Priority |
|-----------|--------|----------|
| Sync trigger for games (cloud → local) | ❌ Missing | P0 |
| Sync trigger for bins (cloud → local) | ❌ Missing | P0 |
| Push lottery data to cloud | ❌ Missing | P1 |
| Bidirectional sync integration | ❌ Missing | P1 |
| Sync timestamps tracking | ⚠️ Partial | P1 |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD DATABASE                           │
│  (Source of Truth for: Games, Bins configuration)              │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUD API SERVICE                           │
│  pullGames() | pullBins() | pushPacks() | pushDayClose()       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   LOTTERY SYNC SERVICE (NEW)                    │
│  syncGamesFromCloud() | syncBinsFromCloud() | pushToCloud()    │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LOCAL SQLITE DATABASE                       │
│  lottery_games | lottery_bins | lottery_packs | etc.           │
│  (Encrypted with SQLCipher - DB-007)                           │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DAL LAYER                                 │
│  LotteryGamesDAL | LotteryBinsDAL | LotteryPacksDAL            │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     IPC HANDLERS                                │
│  lottery:getGames | lottery:receivePack | lottery:activatePack │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RENDERER (React UI)                         │
│  LotteryPage | PackReceptionForm | DayBinsTable | etc.         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Patterns

### Pattern 1: Games Sync (Cloud → Local Only)
```
Cloud DB → pullGames() → upsertFromCloud() → Local DB
```
- Games are **READ-ONLY** locally (defined in cloud dashboard)
- Sync on: App startup, manual refresh, periodic interval

### Pattern 2: Bins Sync (Bidirectional)
```
Cloud DB ←→ pullBins()/pushBins() ←→ upsertFromCloud()/create() ←→ Local DB
```
- Bins can be created locally (bulkCreate) or from cloud
- Sync both directions

### Pattern 3: Packs (Local-First, Push to Cloud)
```
Local Action → Local DB → sync_queue → pushToCloud() → Cloud DB
```
- All pack operations happen locally first
- Queue for cloud sync when online
- Operations: receive, activate, settle, return

### Pattern 4: Day Close (Local-First, Push to Cloud)
```
Day Close → Local DB → sync_queue → pushDayClose() → Cloud DB
```
- Two-phase commit locally (prepare → commit)
- Push summary to cloud after commit

---

## Implementation Phases

---

## Phase 1: Lottery Sync Service Foundation
**Priority:** P0 (Critical)
**Estimated Effort:** 4-6 hours
**Status:** ⬜ Not Started

### Objectives
- Create dedicated lottery sync service
- Implement game sync from cloud
- Implement bin sync from cloud
- Track sync timestamps

### Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 1.1 | Create `src/main/services/lottery-sync.service.ts` | ⬜ | New file |
| 1.2 | Implement `syncGamesFromCloud()` method | ⬜ | Call pullGames → upsertFromCloud |
| 1.3 | Implement `syncBinsFromCloud()` method | ⬜ | Call pullBins → upsertFromCloud |
| 1.4 | Add sync timestamp tracking for lottery entities | ⬜ | Use sync-timestamps.dal.ts |
| 1.5 | Create `initializeLotteryData()` for first-time setup | ⬜ | Called during store setup |
| 1.6 | Add error handling and retry logic | ⬜ | Handle offline gracefully |
| 1.7 | Write unit tests for sync service | ⬜ | Test offline/online scenarios |

### Acceptance Criteria
- [ ] Games sync from cloud to local on demand
- [ ] Bins sync from cloud to local on demand
- [ ] Sync timestamps are recorded
- [ ] Errors are logged and handled gracefully
- [ ] Works offline (uses cached data)

### Code Template
```typescript
// src/main/services/lottery-sync.service.ts
import { cloudApiService } from './cloud-api.service';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
import { storesDAL } from '../dal/stores.dal';
import { createLogger } from '../utils/logger';

const log = createLogger('lottery-sync');

export class LotterySyncService {
  async syncGamesFromCloud(): Promise<{ synced: number; errors: number }> {
    const store = storesDAL.getConfiguredStore();
    if (!store) throw new Error('Store not configured');

    const lastSync = syncTimestampsDAL.getTimestamp('lottery_games');
    const { games } = await cloudApiService.pullGames(lastSync);

    let synced = 0, errors = 0;
    for (const game of games) {
      try {
        lotteryGamesDAL.upsertFromCloud({
          cloud_game_id: game.game_id,
          store_id: store.store_id,
          game_code: game.game_code,
          name: game.name,
          price: game.price,
          pack_value: game.pack_value,
          tickets_per_pack: game.tickets_per_pack,
          status: game.status,
        });
        synced++;
      } catch (err) {
        log.error('Failed to sync game', { gameId: game.game_id, error: err });
        errors++;
      }
    }

    syncTimestampsDAL.setTimestamp('lottery_games', new Date().toISOString());
    return { synced, errors };
  }

  // Similar for syncBinsFromCloud()...
}

export const lotterySyncService = new LotterySyncService();
```

---

## Phase 2: Startup Integration
**Priority:** P0 (Critical)
**Estimated Effort:** 2-3 hours
**Status:** ⬜ Not Started

### Objectives
- Sync lottery data on app startup (if online)
- Sync after successful store setup/API key validation
- Handle first-time initialization

### Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 2.1 | Add lottery sync to app initialization flow | ⬜ | In main/index.ts |
| 2.2 | Sync games after store setup wizard | ⬜ | After API key validated |
| 2.3 | Create bins on first setup if feature enabled | ⬜ | Use bulkCreate() |
| 2.4 | Add IPC handler for manual sync trigger | ⬜ | lottery:syncFromCloud |
| 2.5 | Show sync status in UI | ⬜ | Loading state during sync |

### Acceptance Criteria
- [ ] Games are available after first login
- [ ] Bins are created on first setup
- [ ] Manual sync refresh works
- [ ] UI shows sync progress

---

## Phase 3: Push Operations (Local → Cloud)
**Priority:** P1 (High)
**Estimated Effort:** 6-8 hours
**Status:** ⬜ Not Started

### Objectives
- Push pack operations to cloud
- Push day close data to cloud
- Use sync queue for reliability

### Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 3.1 | Define cloud API endpoints for pack operations | ⬜ | POST /api/v1/lottery/packs |
| 3.2 | Add pack receive to sync queue | ⬜ | Queue on receive() |
| 3.3 | Add pack activation to sync queue | ⬜ | Queue on activate() |
| 3.4 | Add pack settlement to sync queue | ⬜ | Queue on settle() |
| 3.5 | Implement `pushPackOperations()` in cloud API | ⬜ | Batch push |
| 3.6 | Add day close push to cloud | ⬜ | After commitClose() |
| 3.7 | Handle push failures and retries | ⬜ | Exponential backoff |
| 3.8 | Update cloud_pack_id after successful push | ⬜ | Link local to cloud |

### Acceptance Criteria
- [ ] Pack operations queue for sync
- [ ] Day close data pushes to cloud
- [ ] Failed pushes retry automatically
- [ ] Cloud IDs are updated after sync

---

## Phase 4: Bidirectional Sync Integration
**Priority:** P1 (High)
**Estimated Effort:** 4-6 hours
**Status:** ⬜ Not Started

### Objectives
- Integrate lottery sync into existing sync engine
- Handle conflicts between local and cloud
- Support periodic background sync

### Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 4.1 | Add lottery entity types to sync engine | ⬜ | In bidirectional-sync.service.ts |
| 4.2 | Define conflict resolution strategy | ⬜ | Cloud wins for games, local wins for packs |
| 4.3 | Add lottery to periodic sync interval | ⬜ | Every 5 minutes when online |
| 4.4 | Handle deleted games from cloud | ⬜ | Soft delete locally |
| 4.5 | Sync lottery data on network reconnect | ⬜ | Online event handler |

### Acceptance Criteria
- [ ] Lottery syncs with other entities
- [ ] Conflicts resolved correctly
- [ ] Periodic sync includes lottery
- [ ] Reconnection triggers sync

---

## Phase 5: UI Integration & Polish
**Priority:** P2 (Medium)
**Estimated Effort:** 3-4 hours
**Status:** ⬜ Not Started

### Objectives
- Show sync status in lottery UI
- Add manual refresh button
- Display last sync timestamp
- Handle empty state (no games)

### Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 5.1 | Add sync status indicator to LotteryPage | ⬜ | Syncing/Synced/Error |
| 5.2 | Add "Refresh Games" button | ⬜ | Manual sync trigger |
| 5.3 | Show "Last synced: X minutes ago" | ⬜ | Timestamp display |
| 5.4 | Handle empty games state gracefully | ⬜ | "No games available" message |
| 5.5 | Show offline indicator | ⬜ | When cloud unreachable |

### Acceptance Criteria
- [ ] Users can see sync status
- [ ] Manual refresh works
- [ ] Empty states handled gracefully
- [ ] Offline mode clearly indicated

---

## Phase 6: Testing & Validation
**Priority:** P1 (High)
**Estimated Effort:** 4-6 hours
**Status:** ⬜ Not Started

### Objectives
- Comprehensive test coverage
- Integration tests for sync flow
- E2E tests for lottery operations

### Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 6.1 | Unit tests for lottery-sync.service.ts | ⬜ | Mock cloud API |
| 6.2 | Integration tests for sync flow | ⬜ | Real DB, mocked cloud |
| 6.3 | E2E test: First-time setup with lottery | ⬜ | Full flow |
| 6.4 | E2E test: Pack lifecycle | ⬜ | Receive → Activate → Settle |
| 6.5 | Test offline scenarios | ⬜ | Queue works offline |
| 6.6 | Test sync recovery after errors | ⬜ | Retry logic |

### Acceptance Criteria
- [ ] 80%+ code coverage on new code
- [ ] All critical paths tested
- [ ] Offline scenarios validated
- [ ] Error recovery tested

---

## Progress Tracker

### Overall Progress

| Phase | Status | Progress | Target Date |
|-------|--------|----------|-------------|
| Phase 1: Sync Service Foundation | ⬜ Not Started | 0% | TBD |
| Phase 2: Startup Integration | ⬜ Not Started | 0% | TBD |
| Phase 3: Push Operations | ⬜ Not Started | 0% | TBD |
| Phase 4: Bidirectional Sync | ⬜ Not Started | 0% | TBD |
| Phase 5: UI Integration | ⬜ Not Started | 0% | TBD |
| Phase 6: Testing | ⬜ Not Started | 0% | TBD |

**Total Progress: 0%**

### Legend
- ⬜ Not Started
- 🔄 In Progress
- ✅ Complete
- ⏸️ Blocked
- ❌ Cancelled

---

## Technical Specifications

### Sync Timestamps Table
The `sync_timestamps` table tracks last sync time per entity type:

```sql
-- Already exists in v002_sync_tables.sql or needs to be added
CREATE TABLE IF NOT EXISTS sync_timestamps (
  entity_type TEXT PRIMARY KEY,
  last_sync_at TEXT NOT NULL,
  last_sync_status TEXT DEFAULT 'success',
  records_synced INTEGER DEFAULT 0
);
```

### Entity Types for Lottery
```typescript
type LotterySyncEntity =
  | 'lottery_games'      // Cloud → Local only
  | 'lottery_bins'       // Bidirectional
  | 'lottery_packs'      // Local → Cloud only
  | 'lottery_day_close'; // Local → Cloud only
```

### Conflict Resolution Strategy
| Entity | Strategy | Rationale |
|--------|----------|-----------|
| Games | Cloud Wins | Games defined in cloud dashboard |
| Bins | Cloud Wins | Configuration from cloud |
| Packs | Local Wins | Pack operations are authoritative locally |
| Day Close | Local Wins | Finalized data, pushed to cloud |

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Cloud API unavailable | High | Medium | Queue operations, work offline |
| Duplicate pack numbers | High | Low | Unique constraint + validation |
| Data loss during sync | Critical | Low | Transactions, backup before sync |
| Slow sync with many games | Medium | Medium | Pagination, delta sync |

---

## Dependencies

### External
- Cloud API endpoints for lottery sync (verify with backend team)
- Network connectivity for initial setup

### Internal
- Database migrations applied (v003_lottery_tables.sql)
- Store configuration complete
- User authentication working

---

## Notes & Decisions

### Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-12 | Games are read-only locally | Games defined in cloud dashboard by admin |
| 2026-01-12 | Use sync queue for pack push | Reliability over immediate sync |
| 2026-01-12 | Cloud wins for game conflicts | Single source of truth |

### Open Questions
1. What is the expected number of games per store? (affects sync strategy)
2. Should bins be cloud-managed or locally created?
3. What is the sync interval for periodic updates?

---

## Appendix

### File Locations Reference

```
src/main/
├── dal/
│   ├── lottery-games.dal.ts      ✅ Complete
│   ├── lottery-bins.dal.ts       ✅ Complete
│   ├── lottery-packs.dal.ts      ✅ Complete
│   ├── lottery-business-days.dal.ts  ✅ Complete
│   └── sync-timestamps.dal.ts    ⚠️ May need updates
├── services/
│   ├── cloud-api.service.ts      ✅ pullGames/pullBins exist
│   ├── lottery-sync.service.ts   ❌ TO CREATE
│   └── bidirectional-sync.service.ts  ⚠️ Needs lottery integration
├── ipc/
│   └── lottery.handlers.ts       ✅ Complete
└── migrations/
    └── v003_lottery_tables.sql   ✅ Complete
```

### IPC Channels Reference

| Channel | Method | Purpose |
|---------|--------|---------|
| `lottery:getGames` | GET | List active games |
| `lottery:getBins` | GET | List bins with packs |
| `lottery:getPacks` | GET | List packs with filters |
| `lottery:receivePack` | POST | Receive new pack |
| `lottery:activatePack` | POST | Activate pack in bin |
| `lottery:depletePack` | POST | Mark pack as sold out |
| `lottery:returnPack` | POST | Return pack to distributor |
| `lottery:prepareDayClose` | POST | Prepare day close (phase 1) |
| `lottery:commitDayClose` | POST | Commit day close (phase 2) |
| `lottery:parseBarcode` | POST | Parse lottery barcode |
| `lottery:syncFromCloud` | POST | **TO ADD** - Manual sync trigger |

---

*Document Version: 1.0*
*Next Review: After Phase 1 completion*
