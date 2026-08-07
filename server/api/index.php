<?php
declare(strict_types=1);

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) { http_response_code(503); exit(json_encode(['error' => 'Сервер ещё не настроен.'])); }
$config = require $configFile;

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . $config['allowed_origin']);
header('Vary: Origin');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Finance-Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Cache-Control: no-store, private');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

function respond(int $status, array $body): never { http_response_code($status); echo json_encode($body, JSON_UNESCAPED_UNICODE); exit; }
function input(): array { $body = json_decode(file_get_contents('php://input'), true); return is_array($body) ? $body : []; }
function b64url(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function token(array $claims, string $secret): string { $header = b64url(json_encode(['alg'=>'HS256','typ'=>'JWT'])); $payload = b64url(json_encode($claims)); $signature = b64url(hash_hmac('sha256', "$header.$payload", $secret, true)); return "$header.$payload.$signature"; }
function claims(string $secret): array {
  // Apache/FastCGI can expose the Authorization header under different names.
  // Keep this lookup centralized so authenticated sync works on Timeweb too.
  $headers = function_exists('getallheaders') ? getallheaders() : [];
  $auth = $_SERVER['HTTP_AUTHORIZATION']
    ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
    ?? $_SERVER['HTTP_X_FINANCE_AUTHORIZATION']
    ?? $headers['Authorization']
    ?? $headers['authorization']
    ?? $headers['X-Finance-Authorization']
    ?? $headers['x-finance-authorization']
    ?? '';
  if (!preg_match('/^Bearer\s+(.+)$/', $auth, $matches)) respond(401, ['error'=>'Нужно войти в аккаунт.']);
  $parts = explode('.', $matches[1]);
  if (count($parts) !== 3) respond(401, ['error'=>'Недействительная сессия.']);
  $expected = b64url(hash_hmac('sha256', "$parts[0].$parts[1]", $secret, true));
  if (!hash_equals($expected, $parts[2])) respond(401, ['error'=>'Недействительная сессия.']);
  $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
  if (!$payload || ($payload['exp'] ?? 0) < time()) respond(401, ['error'=>'Сессия истекла.']);
  return $payload;
}
function uuid(): string { return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', random_int(0,65535),random_int(0,65535),random_int(0,65535),random_int(16384,20479),random_int(32768,49151),random_int(0,65535),random_int(0,65535),random_int(0,65535)); }
function registrationLimit(array $config): int { return max(1, min(20, (int)($config['max_users'] ?? 20))); }

try { $db = new PDO($config['db_dsn'], $config['db_user'], $config['db_password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]); }
catch (Throwable $error) { respond(503, ['error'=>'Хранилище временно недоступно.']); }

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$basePath = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
if ($basePath !== '' && str_starts_with($path, $basePath)) $path = substr($path, strlen($basePath));
$path = '/' . trim($path, '/');
if ($path === '/health') respond(200, ['ok'=>true]);

if ($path === '/registration-status' && $_SERVER['REQUEST_METHOD'] === 'GET') {
  $limit = registrationLimit($config);
  $used = (int)$db->query('SELECT COUNT(*) FROM finance_users')->fetchColumn();
  respond(200, ['capacity'=>$limit, 'used'=>min($used, $limit), 'available'=>max(0, $limit - $used)]);
}

if ($path === '/register' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  if (!$config['allow_registration']) respond(403, ['error'=>'Регистрация закрыта.']);
  $body=input(); $email=mb_strtolower(trim((string)($body['email'] ?? ''))); $password=(string)($body['password'] ?? '');
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($password) < 12) respond(422, ['error'=>'Укажите корректный e-mail и пароль не короче 12 символов.']);
  $id=uuid();
  try {
    $db->beginTransaction();
    $slotStatement=$db->prepare('SELECT slot FROM finance_registration_slots WHERE user_id IS NULL AND slot <= ? ORDER BY slot LIMIT 1 FOR UPDATE');
    $slotStatement->execute([registrationLimit($config)]);
    $slot=$slotStatement->fetchColumn();
    if ($slot === false) { $db->rollBack(); respond(403, ['error'=>'Достигнут лимит: доступно максимум 20 личных копий приложения.']); }
    $statement=$db->prepare('INSERT INTO finance_users (id,email,password_hash) VALUES (?,?,?)');
    $statement->execute([$id,$email,password_hash($password,PASSWORD_DEFAULT)]);
    $assignSlot=$db->prepare('UPDATE finance_registration_slots SET user_id=? WHERE slot=? AND user_id IS NULL');
    $assignSlot->execute([$id,$slot]);
    if ($assignSlot->rowCount() !== 1) throw new RuntimeException('Не удалось зарезервировать место для аккаунта.');
    $db->commit();
  } catch (PDOException $error) {
    if ($db->inTransaction()) $db->rollBack();
    if ($error->getCode() === '23000') respond(409, ['error'=>'Этот e-mail уже зарегистрирован.']);
    respond(503, ['error'=>'Регистрация временно недоступна. Попробуйте ещё раз.']);
  } catch (Throwable $error) {
    if ($db->inTransaction()) $db->rollBack();
    respond(503, ['error'=>'Регистрация временно недоступна. Попробуйте ещё раз.']);
  }
  respond(201, ['email'=>$email,'token'=>token(['sub'=>$id,'exp'=>time()+60*60*24*180],$config['jwt_secret'])]);
}

if ($path === '/login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $body=input(); $email=mb_strtolower(trim((string)($body['email'] ?? ''))); $password=(string)($body['password'] ?? '');
  $statement=$db->prepare('SELECT id,email,password_hash FROM finance_users WHERE email=? LIMIT 1'); $statement->execute([$email]); $user=$statement->fetch(PDO::FETCH_ASSOC);
  if (!$user || !password_verify($password,$user['password_hash'])) respond(401, ['error'=>'Неверный e-mail или пароль.']);
  respond(200, ['email'=>$user['email'],'token'=>token(['sub'=>$user['id'],'exp'=>time()+60*60*24*180],$config['jwt_secret'])]);
}

if ($path === '/state') {
  $user=claims($config['jwt_secret']);
  if ($_SERVER['REQUEST_METHOD'] === 'GET') { $statement=$db->prepare('SELECT payload,version,updated_at FROM finance_state WHERE user_id=?'); $statement->execute([$user['sub']]); $row=$statement->fetch(PDO::FETCH_ASSOC); respond(200, ['state'=>$row ? json_decode($row['payload'],true) : null,'version'=>$row['version'] ?? 0,'updatedAt'=>$row['updated_at'] ?? null]); }
  if ($_SERVER['REQUEST_METHOD'] === 'PUT') { $body=input(); if (!array_key_exists('state',$body) || !is_array($body['state'])) respond(422,['error'=>'Некорректные данные синхронизации.']); $statement=$db->prepare('INSERT INTO finance_state (user_id,payload,version) VALUES (?,?,1) ON DUPLICATE KEY UPDATE payload=VALUES(payload),version=version+1'); $statement->execute([$user['sub'],json_encode($body['state'],JSON_UNESCAPED_UNICODE)]); respond(200,['version'=>1]); }
}
respond(404, ['error'=>'Маршрут не найден.']);
