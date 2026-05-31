-- 目的地（plan_stops）：新增「营业时间 / 门票 / 预约链接」字段
-- 在服务器数据库执行一次即可（需先部署本 PR 的 php 文件）
-- MySQL 8.0 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，故用存储过程幂等添加，可重复执行。

DROP PROCEDURE IF EXISTS add_stop_info_cols;
DELIMITER //
CREATE PROCEDURE add_stop_info_cols()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_stops' AND COLUMN_NAME = 'open_hours') THEN
    ALTER TABLE `plan_stops` ADD COLUMN `open_hours` VARCHAR(255) NOT NULL DEFAULT '' AFTER `note`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_stops' AND COLUMN_NAME = 'ticket') THEN
    ALTER TABLE `plan_stops` ADD COLUMN `ticket` VARCHAR(255) NOT NULL DEFAULT '' AFTER `open_hours`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_stops' AND COLUMN_NAME = 'booking_url') THEN
    ALTER TABLE `plan_stops` ADD COLUMN `booking_url` VARCHAR(512) NOT NULL DEFAULT '' AFTER `ticket`;
  END IF;
END //
DELIMITER ;
CALL add_stop_info_cols();
DROP PROCEDURE IF EXISTS add_stop_info_cols;
