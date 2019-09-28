/* eslint max-nested-callbacks: ["error", 8] */
/* eslint-env mocha */
'use strict';

const parallel = require('async/parallel');
const waterfall = require('async/waterfall');
const times = require('async/times');
const fs = require('fs-extra');
const percentile = require('percentile');

const IPFSFactory = require('ipfsd-ctl');
const f = IPFSFactory.create({ type: 'proc', exec: require('../js-ipfs/src') });

const NODES = 10;
const DURATION = 10000;
const REQUEST_FREQUENCY = 1000;

const config = {
  Bootstrap: [],
  //Discovery: {
  //MDNS: {
  //Enabled: false
  //},
  //webRTCStar: {
  //Enabled: false
  //}
  //},
  Startrail: {
    popularityManager: {
      cacheThreshold: 2
    }
  }
};

function createNode(startrail, callback) {
  if (typeof startrail === 'function') {
    callback = startrail;
    startrail = false;
  }

  f.spawn(
    {
      config,
      initOptions: { bits: 512 },
      EXPERIMENTAL: {
        startrail
      }
    },
    callback
  );
}

function createBootstrapNodes(done) {
  parallel(
    [
      cb => createNode(true, cb),
      cb => createNode(true, cb),
      cb => createNode(true, cb),
      cb => createNode(true, cb),
      cb => createNode(true, cb)
    ],
    (err, nodes) => {
      if (err) return done(err);

      parallel(nodes.map(node => cb => node.api.id(cb)), (err, ids) => {
        if (err) return done(err);

        const addrs = ids.map(({ addresses }) => addresses[0]);
        config.Bootstrap = addrs;

        done(null, nodes);
      });
    }
  );
}

function createNodes(nodes, done) {
  times(
    NODES,
    (n, cb) => createNode(true, cb),
    (err, _nodes) => {
      if (err) return done(err);

      done(null, nodes.concat(_nodes));
    }
  );
}

function tearDown(nodes, done) {
  parallel(
    nodes.map(node => cb =>
      node.stop(err => {
        err && err.message === 'Already stopped' ? cb() : cb(err);
      })
    ),
    done
  );
}

function printResults(samples) {
  console.log('Variables', {
    num_requests: samples.length,
    num_nodes: NODES,
    percentage_startrail: 'TODO',
    cacheThreshold: config.Startrail.popularityManager.cacheThreshold
  });

  //calculate request latency for each percentile
  const results = [80, 90, 95, 99].map(p => ({
    [p]: percentile(p, samples, i => i.duration)
  }));
  console.log(results);
}

waterfall([createBootstrapNodes, createNodes], async function(err, nodes) {
  if (err) throw err;

  // Seed provider node
  await fs.copy(
    '/Users/joaotiago/code/ipfs/yarchive-jsipfs/blocks',
    nodes[5].path + '/blocks'
  );

  const samples = [];
  const refs = await nodes[5].api.refs.local();
  const hash = refs[Math.floor(Math.random() * refs.length)].ref;

  const intervals = nodes.map(node =>
    setInterval(async () => {
      const data = await node.api.get(hash);
      samples.push({ duration: data[0].duration });
    }, REQUEST_FREQUENCY)
  );

  setTimeout(() => {
    intervals.forEach(clearInterval);
    printResults(samples);
    tearDown(nodes, () => console.log('Nodes stopped'));
  }, DURATION);
});
