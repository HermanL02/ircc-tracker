import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Credentials are stored in plaintext by design; the secret columns are never selected by default.
@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'gckey_username', type: 'text' })
  gckeyUsername: string;

  @Column({ name: 'gckey_password', type: 'text', select: false })
  gckeyPassword: string;

  @Column({ name: 'gckey_totp_secret', type: 'text', select: false })
  gckeyTotpSecret: string;

  @Column({ type: 'text' })
  surname: string;

  @Column({ name: 'given_name', type: 'text' })
  givenName: string;

  @Column({ type: 'text' })
  uci: string;

  @Column({ name: 'application_number', type: 'text' })
  applicationNumber: string;

  // Postgres `date` is returned as a 'YYYY-MM-DD' string, matching the tenant schema.
  @Column({ name: 'date_of_birth', type: 'date' })
  dateOfBirth: string;

  @Column({ name: 'country_of_birth', type: 'text' })
  countryOfBirth: string;

  @Column({ name: 'notify_to', type: 'jsonb' })
  notifyTo: string[];

  // Change detection only compares against successful checks started after this instant.
  @Column({ name: 'baseline_after', type: 'timestamptz', nullable: true })
  baselineAfter: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
