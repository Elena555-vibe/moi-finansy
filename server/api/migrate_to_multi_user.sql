-- Run once on the existing Timeweb database. It is non-destructive: the
-- current account stays intact and claims the first of twenty slots.
CREATE TABLE IF NOT EXISTS finance_registration_slots (
  slot TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  user_id CHAR(36) NULL UNIQUE,
  CONSTRAINT finance_registration_slots_user_fk FOREIGN KEY (user_id) REFERENCES finance_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO finance_registration_slots (slot) VALUES
  (1), (2), (3), (4), (5), (6), (7), (8), (9), (10),
  (11), (12), (13), (14), (15), (16), (17), (18), (19), (20);

UPDATE finance_registration_slots
SET user_id = (SELECT id FROM finance_users ORDER BY created_at ASC LIMIT 1)
WHERE slot = 1
  AND user_id IS NULL
  AND (SELECT COUNT(*) FROM finance_users) = 1;
