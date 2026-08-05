CREATE TABLE finance_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE finance_state (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  -- Longtext keeps the schema compatible with the MySQL version supplied by
  -- ordinary virtual hosting. The API validates JSON before saving it.
  payload LONGTEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT finance_state_user_fk FOREIGN KEY (user_id) REFERENCES finance_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
