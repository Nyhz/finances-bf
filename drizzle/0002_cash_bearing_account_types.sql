UPDATE `accounts` SET `account_type` = 'savings' WHERE `account_type` = 'cash';--> statement-breakpoint
UPDATE `accounts` SET `current_cash_balance_eur` = 0, `opening_balance_eur` = 0 WHERE `account_type` IN ('broker', 'crypto', 'investment');
