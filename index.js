const Emitter = require('events');
const bluebird = require('bluebird');
const redis = require('redis');
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);
const redisOpts = Object.assign('test' === process.env.NODE_ENV ?
  {
    retry_strategy: (options) => { return undefined; },
    disable_resubscribing: true
  } : {}
);
const noop = () => {};
const debug = require('debug')('jambonz:mw-registrar');

function makeUserKey(aor) {
  return `user:${aor}`;
}

class Registrar extends Emitter {
  constructor(logger, opts) {
    super();
    if (!opts) {
      opts = logger;
      logger = Object.create(null);
      logger.info = logger.debug = noop;
    }
    this.logger = logger;
    debug(`connecting to redis with options: ${JSON.stringify(opts)}`);
    this.client = redis.createClient(Object.assign(redisOpts, opts));
    ['ready', 'connect', 'reconnecting', 'error', 'end', 'warning']
      .forEach((event) => {
        this.client.on(event, (...args) => this.emit(event, ...args));
      });
  }

  /**
   * Add a registration for a user identified by a sip address-of-record
   * @param {String} aor - a sip address-of-record for a user (e.g. daveh@drachtio.org)
   * @param {String} contact - the sip address where this user can be reached
   * @param {String} sbcAddress - the sip uri address of the sbc that manages the connection to this user
   * @param {String} protocol - the transport protocol used between the sbc and the user
   * @param {String} expires - number of seconds the registration for this user is active
   * @returns {Boolean} true if the registration was successfully added
   */
  async add(aor, obj, expires) {
    debug(`Registrar#add ${aor} from ${JSON.stringify(obj)} for ${expires}`);
    const key = makeUserKey(aor);
    try {
      const result = await this.client
        .multi()
        .hmset(key, obj)
        .expire(key, expires)
        .execAsync();
      debug(`Registrar#add - result of adding ${aor}: ${JSON.stringify(result)}`);
      return result[0] === 'OK';
    } catch (err) {
      this.logger.error(err, `Error adding user ${aor}`);
      return false;
    }
  }

  /**
   * Retrieve the registration details for a user
   * @param {String} aor - the address-of-record for the user
   * @returns {Object} an object containing the registration details for this user, or null 
   * if the user does not have an active registration.
   */
  async query(aor) {
    const key = makeUserKey(aor);
    const result = await this.client.hgetallAsync(key);
    debug(`Registrar#query: ${aor} returned ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Remove the registration for a user
  * @param {String} aor - the address-of-record for the user
  * @returns {Boolean} true if the registration was successfully removed
  */
  async remove(aor) {
    const key = makeUserKey(aor);
    debug(`Registrar#remove ${aor}`);
    try {
      const result = await this.client.delAsync(key);
      debug(`Registrar#remove ${aor} result: ${result}`);
      return result === 1;
    } catch (err) {
      this.logger.error(err, `Error removing aor ${aor}`);
      return false;
    }
  }

  async keys(prefix) {
    try {
      prefix = prefix || '*';
      const result = await this.client.keysAsync(prefix);
      debug(`keys ${prefix}: ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      this.logger.error(err, `Error keys ${prefix}`);
      debug(err, `Error keys prefix ${prefix}`);
      return null;
    }
  }

  // TODO: change to use SCAN for performance
  async getCountOfUsers() {
    try {
      const result = await this.client.keysAsync('user:*');
      return result.length;
    } catch (err) {
      this.logger.error(err, 'Error retrieving registered users');
    }
  }
}

module.exports = Registrar;
