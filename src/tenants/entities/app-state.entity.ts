import { Column, Entity, PrimaryColumn } from 'typeorm';

// Small key/value store for one-off application flags, e.g. `env_seeded`.
@Entity('app_state')
export class AppState {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'text' })
  value: string;
}
