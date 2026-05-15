SELECT id,name,type,models,model_mapping
FROM channels
WHERE model_mapping LIKE '%OK-video%'
   OR models LIKE '%OK-video%'
   OR model_mapping LIKE '%grok-video%'
LIMIT 10;

SHOW TABLES LIKE '%task%';
SHOW TABLES LIKE 'logs';

DESCRIBE tasks;
SELECT id,task_id,user_id,channel_id,action,status,created_at,updated_at,fail_reason,LEFT(CAST(properties AS CHAR),500),LEFT(CAST(data AS CHAR),500),LEFT(CAST(private_data AS CHAR),500)
FROM tasks
WHERE CAST(properties AS CHAR) LIKE '%OK-video%'
   OR CAST(data AS CHAR) LIKE '%OK-video%'
   OR CAST(private_data AS CHAR) LIKE '%OK-video%'
   OR CAST(properties AS CHAR) LIKE '%grok-video%'
   OR CAST(data AS CHAR) LIKE '%grok-video%'
   OR CAST(private_data AS CHAR) LIKE '%grok-video%'
ORDER BY id DESC
LIMIT 10;
