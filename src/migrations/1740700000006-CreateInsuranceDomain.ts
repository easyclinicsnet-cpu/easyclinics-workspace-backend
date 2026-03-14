import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInsuranceDomain1740700000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create insurance_providers table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`insurance_providers\` (
        \`id\` varchar(36) NOT NULL,
        \`providerCode\` varchar(255) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`shortName\` varchar(255) DEFAULT NULL,
        \`status\` enum('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
        \`description\` text DEFAULT NULL,
        \`contactInfo\` longtext DEFAULT NULL,
        \`processingTimes\` longtext DEFAULT NULL,
        \`requiresPreAuthorization\` tinyint(4) NOT NULL DEFAULT 0,
        \`supportsElectronicClaims\` tinyint(4) NOT NULL DEFAULT 1,
        \`claimsSubmissionFormat\` varchar(255) DEFAULT NULL,
        \`defaultCopaymentPercentage\` decimal(5,2) NOT NULL DEFAULT 0.00,
        \`maximumClaimAmount\` decimal(12,2) DEFAULT NULL,
        \`minimumClaimAmount\` decimal(12,2) DEFAULT NULL,
        \`contractNumber\` varchar(255) DEFAULT NULL,
        \`contractStartDate\` date DEFAULT NULL,
        \`contractEndDate\` date DEFAULT NULL,
        \`termsAndConditions\` text DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_119e4405733c0ef79ede1e887d\` (\`providerCode\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 2. Create insurance_schemes table (FK to insurance_providers inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`insurance_schemes\` (
        \`id\` varchar(36) NOT NULL,
        \`providerId\` varchar(255) NOT NULL,
        \`schemeCode\` varchar(255) NOT NULL,
        \`schemeName\` varchar(255) NOT NULL,
        \`schemeType\` enum('HMO','PPO','EPO','POS','INDEMNITY','OTHER') NOT NULL DEFAULT 'OTHER',
        \`status\` enum('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
        \`description\` text DEFAULT NULL,
        \`defaultCoveragePercentage\` decimal(5,2) NOT NULL DEFAULT 100.00,
        \`coverageRules\` longtext DEFAULT NULL,
        \`benefitLimits\` longtext DEFAULT NULL,
        \`requiresPreAuthorization\` tinyint(4) NOT NULL DEFAULT 0,
        \`restrictedToNetwork\` tinyint(4) NOT NULL DEFAULT 0,
        \`networkProviders\` text DEFAULT NULL,
        \`outOfNetworkPenalty\` decimal(5,2) DEFAULT NULL,
        \`monthlyPremium\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`annualDeductible\` decimal(12,2) DEFAULT NULL,
        \`copaymentAmount\` decimal(12,2) DEFAULT NULL,
        \`effectiveDate\` date DEFAULT NULL,
        \`expiryDate\` date DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`authorizationRequirements\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_083b927371c8cfac198bc44d03\` (\`schemeCode\`),
        KEY \`FK_b25c31276ee75b71be19330ba53\` (\`providerId\`),
        CONSTRAINT \`FK_b25c31276ee75b71be19330ba53\` FOREIGN KEY (\`providerId\`) REFERENCES \`insurance_providers\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 3. Create insurance_contracts table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`insurance_contracts\` (
        \`id\` varchar(36) NOT NULL,
        \`insurerName\` varchar(255) NOT NULL,
        \`contractNumber\` varchar(255) NOT NULL,
        \`coveredItems\` longtext DEFAULT NULL,
        \`effectiveDate\` date NOT NULL,
        \`expiryDate\` date NOT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`patientEligibility\` longtext DEFAULT NULL,
        \`annualLimit\` decimal(12,2) DEFAULT NULL,
        \`utilizedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 4. Create patient_insurance table (cross-domain FKs added via ALTER TABLE)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`patient_insurance\` (
        \`id\` varchar(36) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`insuranceProviderId\` varchar(255) NOT NULL,
        \`schemeId\` varchar(255) NOT NULL,
        \`membershipNumber\` varchar(255) NOT NULL,
        \`policyNumber\` varchar(255) DEFAULT NULL,
        \`memberType\` enum('PRINCIPAL','DEPENDENT') NOT NULL DEFAULT 'PRINCIPAL',
        \`principalMemberId\` varchar(255) DEFAULT NULL,
        \`relationshipToPrincipal\` varchar(255) DEFAULT NULL,
        \`status\` enum('ACTIVE','INACTIVE','SUSPENDED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
        \`isPrimary\` tinyint(4) NOT NULL DEFAULT 1,
        \`priority\` int(11) NOT NULL DEFAULT 1,
        \`effectiveDate\` date NOT NULL,
        \`expiryDate\` date NOT NULL,
        \`enrollmentDate\` datetime DEFAULT NULL,
        \`currentAuthorizationNumber\` varchar(255) DEFAULT NULL,
        \`authorizationExpiryDate\` date DEFAULT NULL,
        \`authorizationNotes\` text DEFAULT NULL,
        \`currentYearUtilization\` longtext DEFAULT NULL,
        \`insuranceContactPerson\` varchar(255) DEFAULT NULL,
        \`insuranceContactPhone\` varchar(255) DEFAULT NULL,
        \`insuranceContactEmail\` varchar(255) DEFAULT NULL,
        \`lastVerifiedDate\` date DEFAULT NULL,
        \`verifiedBy\` varchar(255) DEFAULT NULL,
        \`verificationNotes\` text DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_2eef7a781c3760977b6bf111f9\` (\`patientId\`),
        UNIQUE KEY \`REL_2eef7a781c3760977b6bf111f9\` (\`patientId\`),
        KEY \`FK_39f43a6b0815267cbcf78e44096\` (\`insuranceProviderId\`),
        KEY \`FK_4d9743655e08390d9ef34fee2ef\` (\`schemeId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 4a. Cross-domain FK: patient_insurance → patients
    await queryRunner.query(`
      ALTER TABLE \`patient_insurance\` ADD CONSTRAINT \`FK_2eef7a781c3760977b6bf111f98\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 4b. Cross-domain FK: patient_insurance → insurance_providers
    await queryRunner.query(`
      ALTER TABLE \`patient_insurance\` ADD CONSTRAINT \`FK_39f43a6b0815267cbcf78e44096\` FOREIGN KEY (\`insuranceProviderId\`) REFERENCES \`insurance_providers\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 4c. Cross-domain FK: patient_insurance → insurance_schemes
    await queryRunner.query(`
      ALTER TABLE \`patient_insurance\` ADD CONSTRAINT \`FK_4d9743655e08390d9ef34fee2ef\` FOREIGN KEY (\`schemeId\`) REFERENCES \`insurance_schemes\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 5. Create insurance_claims table (cross-domain FKs added via ALTER TABLE)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`insurance_claims\` (
        \`id\` varchar(36) NOT NULL,
        \`claimNumber\` varchar(255) NOT NULL,
        \`insuranceClaimNumber\` varchar(255) DEFAULT NULL,
        \`preAuthorizationNumber\` varchar(255) DEFAULT NULL,
        \`billId\` varchar(255) NOT NULL,
        \`patientInsuranceId\` varchar(255) NOT NULL,
        \`insuranceProviderId\` varchar(255) NOT NULL,
        \`status\` enum('DRAFT','PENDING','SUBMITTED','IN_REVIEW','APPROVED','PARTIALLY_APPROVED','REJECTED','PAID','APPEALED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        \`totalClaimedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`approvedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`deniedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`patientResponsibility\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`paidAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`submissionMethod\` enum('ELECTRONIC','PAPER','PORTAL','EMAIL','FAX') DEFAULT NULL,
        \`submittedAt\` timestamp NULL DEFAULT NULL,
        \`submittedBy\` varchar(255) DEFAULT NULL,
        \`submissionNotes\` text DEFAULT NULL,
        \`receivedByInsuranceAt\` timestamp NULL DEFAULT NULL,
        \`processedAt\` timestamp NULL DEFAULT NULL,
        \`adjudicationDetails\` longtext DEFAULT NULL,
        \`paymentDetails\` longtext DEFAULT NULL,
        \`paymentReceivedAt\` timestamp NULL DEFAULT NULL,
        \`rejectionDetails\` longtext DEFAULT NULL,
        \`isAppealed\` tinyint(4) NOT NULL DEFAULT 0,
        \`appealedAt\` timestamp NULL DEFAULT NULL,
        \`appealNotes\` text DEFAULT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`membershipNumber\` varchar(255) NOT NULL,
        \`serviceStartDate\` date NOT NULL,
        \`serviceEndDate\` date NOT NULL,
        \`serviceTimeIn\` time DEFAULT NULL,
        \`serviceTimeOut\` time DEFAULT NULL,
        \`diagnosisCode\` varchar(255) DEFAULT NULL,
        \`diagnosisDescription\` varchar(255) DEFAULT NULL,
        \`procedureCodes\` text DEFAULT NULL,
        \`attachments\` text DEFAULT NULL,
        \`clinicalNotes\` text DEFAULT NULL,
        \`preparedBy\` varchar(255) DEFAULT NULL,
        \`reviewedBy\` varchar(255) DEFAULT NULL,
        \`reviewedAt\` timestamp NULL DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_7c69728b0eee8df90aa28cb3aa\` (\`claimNumber\`),
        UNIQUE KEY \`REL_899d7eba7946d2095d95a2afc5\` (\`billId\`),
        KEY \`FK_98190c2adc3ab8b1350839c9d16\` (\`patientInsuranceId\`),
        KEY \`FK_90c8f015e16d6d0db49235d8aec\` (\`insuranceProviderId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 5a. Cross-domain FK: insurance_claims → patient_bills
    await queryRunner.query(`
      ALTER TABLE \`insurance_claims\` ADD CONSTRAINT \`FK_899d7eba7946d2095d95a2afc59\` FOREIGN KEY (\`billId\`) REFERENCES \`patient_bills\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // 5b. Cross-domain FK: insurance_claims → insurance_providers
    await queryRunner.query(`
      ALTER TABLE \`insurance_claims\` ADD CONSTRAINT \`FK_90c8f015e16d6d0db49235d8aec\` FOREIGN KEY (\`insuranceProviderId\`) REFERENCES \`insurance_providers\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 5c. Cross-domain FK: insurance_claims → patient_insurance
    await queryRunner.query(`
      ALTER TABLE \`insurance_claims\` ADD CONSTRAINT \`FK_98190c2adc3ab8b1350839c9d16\` FOREIGN KEY (\`patientInsuranceId\`) REFERENCES \`patient_insurance\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 6. Create insurance_claim_items table (cross-domain FKs added via ALTER TABLE)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`insurance_claim_items\` (
        \`id\` varchar(36) NOT NULL,
        \`claimId\` varchar(255) NOT NULL,
        \`billItemId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) DEFAULT NULL,
        \`description\` varchar(255) NOT NULL,
        \`quantity\` decimal(12,4) NOT NULL,
        \`unitPrice\` decimal(12,2) NOT NULL,
        \`totalAmount\` decimal(12,2) NOT NULL,
        \`itemCategory\` enum('MEDICATION','CONSUMABLE','SERVICE') DEFAULT NULL,
        \`claimedAmount\` decimal(12,2) NOT NULL,
        \`approvedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`deniedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`adjustmentAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`patientResponsibility\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`status\` enum('CLAIMED','PENDING','APPROVED','PARTIALLY_APPROVED','DENIED','ADJUSTED') NOT NULL DEFAULT 'PENDING',
        \`coverageBreakdown\` longtext DEFAULT NULL,
        \`appliedCoveragePercentage\` decimal(5,2) DEFAULT NULL,
        \`denialReason\` longtext DEFAULT NULL,
        \`adjustmentReason\` text DEFAULT NULL,
        \`adjudicationNotes\` text DEFAULT NULL,
        \`procedureCode\` varchar(255) DEFAULT NULL,
        \`diagnosisCode\` varchar(255) DEFAULT NULL,
        \`revenueCode\` varchar(255) DEFAULT NULL,
        \`modifiers\` text DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`patientInsuranceId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_a0bc4fdb880c58e9876b8504666\` (\`claimId\`),
        KEY \`FK_62f102022e1c8f12baf86424667\` (\`billItemId\`),
        KEY \`FK_329fcacf4a0e64265cd88c2a4ca\` (\`appointmentId\`),
        KEY \`FK_c473df5da170caf740c057bad08\` (\`patientInsuranceId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 6a. Cross-domain FK: insurance_claim_items → insurance_claims
    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` ADD CONSTRAINT \`FK_a0bc4fdb880c58e9876b8504666\` FOREIGN KEY (\`claimId\`) REFERENCES \`insurance_claims\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // 6b. Cross-domain FK: insurance_claim_items → bill_items
    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` ADD CONSTRAINT \`FK_62f102022e1c8f12baf86424667\` FOREIGN KEY (\`billItemId\`) REFERENCES \`bill_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 6c. Cross-domain FK: insurance_claim_items → appointments
    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` ADD CONSTRAINT \`FK_329fcacf4a0e64265cd88c2a4ca\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // 6d. Cross-domain FK: insurance_claim_items → patient_insurance
    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` ADD CONSTRAINT \`FK_c473df5da170caf740c057bad08\` FOREIGN KEY (\`patientInsuranceId\`) REFERENCES \`patient_insurance\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys on insurance_claim_items
    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` DROP FOREIGN KEY IF EXISTS \`FK_c473df5da170caf740c057bad08\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` DROP FOREIGN KEY IF EXISTS \`FK_329fcacf4a0e64265cd88c2a4ca\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` DROP FOREIGN KEY IF EXISTS \`FK_62f102022e1c8f12baf86424667\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`insurance_claim_items\` DROP FOREIGN KEY IF EXISTS \`FK_a0bc4fdb880c58e9876b8504666\`
    `);

    // Drop foreign keys on insurance_claims
    await queryRunner.query(`
      ALTER TABLE \`insurance_claims\` DROP FOREIGN KEY IF EXISTS \`FK_98190c2adc3ab8b1350839c9d16\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`insurance_claims\` DROP FOREIGN KEY IF EXISTS \`FK_90c8f015e16d6d0db49235d8aec\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`insurance_claims\` DROP FOREIGN KEY IF EXISTS \`FK_899d7eba7946d2095d95a2afc59\`
    `);

    // Drop foreign keys on patient_insurance
    await queryRunner.query(`
      ALTER TABLE \`patient_insurance\` DROP FOREIGN KEY IF EXISTS \`FK_4d9743655e08390d9ef34fee2ef\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_insurance\` DROP FOREIGN KEY IF EXISTS \`FK_39f43a6b0815267cbcf78e44096\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_insurance\` DROP FOREIGN KEY IF EXISTS \`FK_2eef7a781c3760977b6bf111f98\`
    `);

    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS \`insurance_claim_items\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`insurance_claims\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`patient_insurance\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`insurance_contracts\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`insurance_schemes\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`insurance_providers\``);
  }
}
