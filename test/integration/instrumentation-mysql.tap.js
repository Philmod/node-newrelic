'use strict';

var path    = require('path')
  , tap     = require('tap')
  , test    = tap.test
  , shimmer = require(path.join(__dirname, '..', '..', 'lib', 'shimmer'))
  , helper  = require(path.join(__dirname, '..', 'lib', 'agent_helper'))
  ;

test("MySQL instrumentation should find the MySQL call in the transaction trace",
     function (t) {
  t.plan(22);

  var self = this;
  helper.bootstrapMySQL(function (error, app) {
    if (error) return t.fail(error);

    var agent = helper.loadMockedAgent();
    shimmer.bootstrapInstrumentation(agent);
    var mysql = require('mysql');

    var client = mysql.createClient({
      user     : 'test_user',
      database : 'agent_integration'
    });
    t.ok(client, "Client should be created OK.");

    self.tearDown(function () {
      client.end(function (error) {
        if (error) t.fail(error);

        helper.cleanMySQL(app, function done() {
          helper.unloadAgent(agent);
        });
      });
    });

    t.notOk(agent.getTransaction(), "no transaction should be in play yet.");
    var wrapped = agent.tracer.transactionProxy(function transactionInScope() {
      client.query("SELECT * FROM test WHERE id = ?", [1], function (error, rows) {
        if (error) return t.fail(error);

        t.ok(agent.getTransaction(), "transaction should be visible");
        t.equals(rows.length, 1, "there should be one row");
        var row = rows[0];
        t.equals(row.id, 1, "mysql driver should still work (found id)");
        t.equals(row.test_value, 'hamburgefontstiv', "mysql driver should still work (found value)");

        client.query("INSERT INTO test (test_value) VALUE (\"raxjambles\")", function (error) {
          if (error) return t.fail(error);

          t.ok(agent.getTransaction(), "transaction should still be visible");
          client.query("SELECT COUNT(*) AS num_rows FROM test", function (error, rows) {
            if (error) return t.fail(error);

            var transaction = agent.getTransaction();
            t.ok(transaction, "transaction should still be visible");

            t.equals(rows.length, 1, "there should be one row");
            var row = rows[0];
            t.equals(row.num_rows, 2, "should have found 2 rows");

            transaction.end();

            var trace = transaction.getTrace();
            t.ok(trace, "trace should exist");
            t.ok(trace.root, "root element should exist.");
            t.equals(trace.root.children.length, 1, "There should be only one child.");

            var selectSegment = trace.root.children[0];
            t.ok(selectSegment, "trace segment for first SELECT should exist");
            t.equals(selectSegment.name, "Database/test/select", "should register as SELECT");
            t.equals(selectSegment.children.length, 1, "SELECT should have a single child");

            var insertSegment = selectSegment.children[0];
            t.ok(insertSegment, "trace segment for INSERT should exist");
            t.equals(insertSegment.name, "Database/test/insert", "should register as INSERT");
            t.equals(insertSegment.children.length, 1, "INSERT should have a single child");

            var countSegment = insertSegment.children[0];
            t.ok(countSegment, "trace segment for SELECT COUNT(*) should exist");
            t.equals(countSegment.name, "Database/test/select", "should register as SELECT");
            t.equals(countSegment.children.length, 0, "SELECT COUNT should leave us here at the end");

            t.end();
          });
        });
      });
    });
    wrapped();
  });
});
