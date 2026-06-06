-- 随手拍（moments）表
CREATE TABLE IF NOT EXISTS moments (
  id          VARCHAR(32)   NOT NULL PRIMARY KEY,
  openid      VARCHAR(64)   NOT NULL DEFAULT '',
  image_url   VARCHAR(512)  NOT NULL,
  caption     TEXT,                          -- AI 生成的文字描述
  tags        JSON,                          -- AI 打的标签数组，如 ["海边","黄昏","治愈"]
  ai_score    TINYINT UNSIGNED DEFAULT 0,    -- AI 评分 0-100，用于精华筛选
  journey_id  VARCHAR(32)   DEFAULT NULL,    -- 可选关联足迹
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_created (created_at),
  INDEX idx_score (ai_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
