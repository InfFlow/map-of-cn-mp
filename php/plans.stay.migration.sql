-- 目的地（plan_stops）：新增「建议游玩时长（分钟）」字段 stay_minutes
-- 在服务器数据库执行一次即可（需先部署本 PR 的 php 文件）
-- MySQL 8.0 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，故用存储过程幂等添加，可重复执行。

DROP PROCEDURE IF EXISTS add_stop_stay_col;
DELIMITER //
CREATE PROCEDURE add_stop_stay_col()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_stops' AND COLUMN_NAME = 'stay_minutes') THEN
    ALTER TABLE `plan_stops` ADD COLUMN `stay_minutes` INT NOT NULL DEFAULT 0 AFTER `planned_time`;
  END IF;
END //
DELIMITER ;
CALL add_stop_stay_col();
DROP PROCEDURE IF EXISTS add_stop_stay_col;
