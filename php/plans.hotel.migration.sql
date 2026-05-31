-- 旅行计划：新增「住宿酒店」与「每天出发点」字段
-- 在服务器数据库执行一次即可（需先部署本 PR 的 php 文件）
-- MySQL 8.0 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，故用存储过程幂等添加，可重复执行。

DROP PROCEDURE IF EXISTS add_plan_hotel_cols;
DELIMITER //
CREATE PROCEDURE add_plan_hotel_cols()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'hotel_name') THEN
    ALTER TABLE `trip_plans` ADD COLUMN `hotel_name` VARCHAR(128) NOT NULL DEFAULT '' AFTER `note`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'hotel_address') THEN
    ALTER TABLE `trip_plans` ADD COLUMN `hotel_address` VARCHAR(256) NOT NULL DEFAULT '' AFTER `hotel_name`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'hotel_lat') THEN
    ALTER TABLE `trip_plans` ADD COLUMN `hotel_lat` DECIMAL(10,6) NULL AFTER `hotel_address`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'hotel_lng') THEN
    ALTER TABLE `trip_plans` ADD COLUMN `hotel_lng` DECIMAL(10,6) NULL AFTER `hotel_lat`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'day_starts') THEN
    ALTER TABLE `trip_plans` ADD COLUMN `day_starts` TEXT NULL AFTER `hotel_lng`;
  END IF;
END //
DELIMITER ;
CALL add_plan_hotel_cols();
DROP PROCEDURE IF EXISTS add_plan_hotel_cols;
