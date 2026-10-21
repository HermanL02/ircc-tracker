import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { ApplicationDetails, HistoryItem } from '../lib/snapshot.js';

export type CheckTrigger = 'boot' | 'schedule' | 'manual';
export type CheckStatus = 'running' | 'ok' | 'error';

@Entity('checks')
export class Check {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  trigger: CheckTrigger;

  @Column({ type: 'varchar', length: 16 })
  status: CheckStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'content_hash', type: 'varchar', length: 64, nullable: true })
  contentHash: string | null;

  // True when this snapshot differs from the previous successful one.
  @Column({ type: 'boolean', default: false })
  changed: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  changes: string[];

  @Column({ name: 'app_status', type: 'varchar', length: 64, nullable: true })
  appStatus: string | null;

  @Column({ name: 'last_updated', type: 'timestamptz', nullable: true })
  lastUpdated: Date | null;

  @Column({ type: 'jsonb', nullable: true, select: false })
  details: ApplicationDetails | null;

  @Column({ type: 'jsonb', nullable: true, select: false })
  history: HistoryItem[] | null;
}
