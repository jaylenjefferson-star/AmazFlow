// In-memory stand-in for the pieces of DynamoDB the control plane actually uses, wired under
// require() so the real deployed handler source runs unmodified.
const Module = require("module");
const crypto = require("crypto");

const store = new Map(); // "pk|sk" -> item
const key = (pk, sk) => `${pk}|${sk}`;

class Cmd { constructor(i) { this.input = i; } }
class PutItemCommand extends Cmd {}
class GetItemCommand extends Cmd {}
class ScanCommand extends Cmd {}
class QueryCommand extends Cmd {}
class TransactWriteItemsCommand extends Cmd {}
class DeleteItemCommand extends Cmd {}

class CondFail extends Error { constructor() { super("cond"); this.name = "ConditionalCheckFailedException"; } }

/* ------------------------------------------------------------------ in-memory user pool ----- */

class ListUsersCommand extends Cmd {}
class ListUsersInGroupCommand extends Cmd {}
class AdminEnableUserCommand extends Cmd {}
class AdminDisableUserCommand extends Cmd {}
class AdminCreateUserCommand extends Cmd {}
class AdminAddUserToGroupCommand extends Cmd {}
class AdminGetUserCommand extends Cmd {}

class UsernameExists extends Error { constructor() { super("User already exists"); this.name = "UsernameExistsException"; } }
class UserNotFound extends Error { constructor() { super("User does not exist"); this.name = "UserNotFoundException"; } }

/** username -> { Username, Attributes[], Enabled, UserStatus, UserCreateDate } */
const users = new Map();
/** group name -> Set<username> */
const groups = new Map();
/** Set on the harness to make the next AdminAddUserToGroup fail, for the partial-failure test. */
const cognitoFaults = { failNextAddToGroup: false };

const attrList = (obj) => Object.entries(obj).map(([Name, Value]) => ({ Name, Value }));

const cognito = {
  async send(cmd) {
    if (cmd instanceof AdminCreateUserCommand) {
      const username = cmd.input.Username;
      if (users.has(username)) throw new UsernameExists();
      const record = {
        Username: username,
        Attributes: cmd.input.UserAttributes || [],
        Enabled: true,
        UserStatus: "FORCE_CHANGE_PASSWORD",
        UserCreateDate: new Date(),
      };
      users.set(username, record);
      return { User: record };
    }
    if (cmd instanceof AdminAddUserToGroupCommand) {
      if (cognitoFaults.failNextAddToGroup) {
        cognitoFaults.failNextAddToGroup = false;
        throw new Error("harness: simulated AdminAddUserToGroup failure");
      }
      const { Username, GroupName } = cmd.input;
      if (!users.has(Username)) throw new UserNotFound();
      if (!groups.has(GroupName)) groups.set(GroupName, new Set());
      groups.get(GroupName).add(Username);
      return {};
    }
    if (cmd instanceof ListUsersCommand) {
      return { Users: [...users.values()] };
    }
    if (cmd instanceof ListUsersInGroupCommand) {
      const members = groups.get(cmd.input.GroupName) || new Set();
      return { Users: [...members].map((u) => users.get(u)).filter(Boolean) };
    }
    if (cmd instanceof AdminGetUserCommand) {
      const found = users.get(cmd.input.Username);
      if (!found) throw new UserNotFound();
      return found;
    }
    if (cmd instanceof AdminEnableUserCommand || cmd instanceof AdminDisableUserCommand) {
      const found = users.get(cmd.input.Username);
      if (!found) throw new UserNotFound();
      found.Enabled = cmd instanceof AdminEnableUserCommand;
      return {};
    }
    throw new Error("harness: unsupported cognito command " + cmd.constructor.name);
  },
};

/** Seed a pool member directly, for tests that need an existing team rather than an invitation. */
const seedUser = (username, { tenantId, role, enabled = true, status = "CONFIRMED" }) => {
  users.set(username, {
    Username: username,
    Attributes: attrList({ email: username, "custom:tenant_id": tenantId }),
    Enabled: enabled,
    UserStatus: status,
    UserCreateDate: new Date(),
  });
  if (role) {
    if (!groups.has(role)) groups.set(role, new Set());
    groups.get(role).add(username);
  }
};

const resetPool = () => {
  users.clear();
  groups.clear();
  cognitoFaults.failNextAddToGroup = false;
};

function evalCondition(expr, existing, values) {
  if (!expr) return true;
  // Only the two forms this codebase uses.
  if (expr === "attribute_not_exists(pk)") return !existing;
  if (expr === "attribute_not_exists(pk) OR leaseExpiresAtMs < :nowMs") {
    if (!existing) return true;
    const lease = Number(existing.leaseExpiresAtMs?.N ?? "0");
    return lease < Number(values[":nowMs"].N);
  }
  throw new Error("harness: unsupported ConditionExpression " + expr);
}

function put(input) {
  const pk = input.Item.pk.S, sk = input.Item.sk.S;
  const existing = store.get(key(pk, sk));
  if (!evalCondition(input.ConditionExpression, existing, input.ExpressionAttributeValues || {})) throw new CondFail();
  store.set(key(pk, sk), input.Item);
}

const db = {
  async send(cmd) {
    if (cmd instanceof PutItemCommand) { put(cmd.input); return {}; }
    if (cmd instanceof GetItemCommand) {
      const it = store.get(key(cmd.input.Key.pk.S, cmd.input.Key.sk.S));
      return it ? { Item: it } : {};
    }
    if (cmd instanceof ScanCommand) return { Items: [...store.values()] };
    if (cmd instanceof QueryCommand) {
      // Two key-condition shapes are in use: the prefix scan (begins_with) that the list
      // helpers issue, and the exact-key lookup that getOrganization and getWorkflowVersion
      // issue. Reading :prefix unconditionally used to throw on the second form, so any handler
      // path that fetched a single item by key failed here as a 500 rather than being tested.
      const v = cmd.input.ExpressionAttributeValues || {};
      const pk = v[":pk"] && v[":pk"].S;
      const all = [...store.values()].filter((i) => i.pk.S === pk);
      if (v[":sk"]) return { Items: all.filter((i) => i.sk.S === v[":sk"].S) };
      if (v[":prefix"]) return { Items: all.filter((i) => i.sk.S.startsWith(v[":prefix"].S)) };
      throw new Error(
        "harness: unsupported KeyConditionExpression " + (cmd.input.KeyConditionExpression || "(none)"),
      );
    }
    if (cmd instanceof TransactWriteItemsCommand) {
      for (const t of cmd.input.TransactItems) { if (t.Put) put(t.Put); }
      return {};
    }
    if (cmd instanceof DeleteItemCommand) { store.delete(key(cmd.input.Key.pk.S, cmd.input.Key.sk.S)); return {}; }
    throw new Error("harness: unsupported command " + cmd.constructor.name);
  },
};

const stubs = {
  "@aws-sdk/client-dynamodb": {
    DynamoDBClient: class { async send(c) { return db.send(c); } },
    PutItemCommand, GetItemCommand, ScanCommand, QueryCommand, TransactWriteItemsCommand, DeleteItemCommand,
  },
  "@aws-sdk/client-bedrock-runtime": { BedrockRuntimeClient: class { async send() { throw new Error("no bedrock in harness"); } }, ConverseCommand: Cmd },
  "@aws-sdk/client-sesv2": { SESv2Client: class { async send() { return {}; } }, SendEmailCommand: Cmd },
  "@aws-sdk/client-cognito-identity-provider": {
    // A working in-memory user pool rather than a stub that always answers "no users".
    // Invitations are the one flow whose whole job is to mutate the pool, so a stub that cannot
    // hold a user could only ever assert that the handler did not crash.
    CognitoIdentityProviderClient: class {
      async send(cmd) {
        return cognito.send(cmd);
      }
    },
    ListUsersCommand, ListUsersInGroupCommand, AdminEnableUserCommand, AdminDisableUserCommand,
    AdminCreateUserCommand, AdminAddUserToGroupCommand, AdminGetUserCommand,
  },
  "@aws-sdk/client-bedrock-agentcore": { BedrockAgentCoreClient: class { async send() { throw new Error("no agentcore in harness"); } }, InvokeHarnessCommand: Cmd },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs[request]) return stubs[request];
  return realLoad.apply(this, arguments);
};

process.env.TABLE_NAME = "harness-table";
process.env.USER_POOL_ID = "harness-pool";
process.env.DATA_BOUNDARY = "harness";
process.env.EXECUTION_GRANT_SECRET = "harness-secret-not-a-real-key";
process.env.BEDROCK_MODEL_ID = "harness-model";

module.exports = { store, key, db, crypto, users, groups, seedUser, resetPool, cognitoFaults };
