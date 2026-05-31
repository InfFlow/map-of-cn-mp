-- 行程计划（trip_plans）：新增「多晚/分段住宿」字段 hotels（JSON 数组，TEXT 存储）
-- 每段： { name, address, lat, lng, startDay, endDay }（startDay/endDay 为第几天，含两端）
-- 兼容旧单酒店：hotels 为空时回退 hotel_name/hotel_address/hotel_lat/hotel_lng
-- MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，故用存储过程幂等添加

DROP PROCEDURE IF EXISTS add_plan_hotels_col;
DELIMITER //
CREATE PROCEDURE add_plan_hotels_col()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_plans' AND COLUMN_NAME = 'hotels') THEN
    ALTER TABLE `trip_plans` ADD COLUMN `hotels` TEXT NULL AFTER `hotel_lng`;
  END IF;
END //
DELIMITER ;
CALL add_plan_hotels_col();
DROP PROCEDURE IF EXISTS add_plan_hotels_col;
