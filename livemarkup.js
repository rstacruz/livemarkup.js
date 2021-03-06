/*! Livemarkup.js -- ricostacruz.com/livemarkup
    (c) 2013, MIT licensed */

(function(lm) {
  if (typeof module === 'object') module.exports = lm;
  else this.LM = lm;
})(function($, _) {

  var on = $.fn.on ? 'on' : 'bind',
    off = $.fn.off ? 'off' : 'unbind',
    radio = 'input[type="radio"]',
    check = 'input[type="checkbox"]',
    multiple = "select[multiple]";

  /**
   * The syntax for directives.
   * This allows for `@each`, `lm-each`, `lm_each`, `lm:each`, `data-lm-each`,
   * taking cue from Angular's format to make it optionally HTML validator compliant.
   */

  var dirFormat = {
    prefix: /(?:@|lm-|lm_|lm:|data-lm-)/,
    action: /([a-zA-Z0-9\_]+)/,
    param: /(?::(.+))?/
  };

  var dirMatcher = new RegExp(
    '^' +
    dirFormat.prefix.source +
    dirFormat.action.source +
    dirFormat.param.source + '$');

  /**
   * Returns a template object.
   *
   *     var $div = $("...");
   *     LM($div);
   *
   * Full example:
   *
   *     var $div = $("#my_template");
   *     var template = LM($div)
   *      .bind(model)
   *      .locals({ count: 200 })
   *      .render();
   *
   * You may also pass a Backbone view to `LM()`.
   *
   *     Backbone.View.extend({
   *       render: function() {
   *         this.html(require('templates/book/show'));
   *         this.template = LM(this)
   *           .bind(this.model)
   *           .render();
   *       };
   *     }
   *
   * `LM(element)` is an alias for `new LM.template(element)`, and hence it
   * returns a [Template] object. See [Template] documentation for more
   * details.
   */

  var LM = function(element) {
    return new Template(element);
  };

  /**
   * You may set helpers that will be available on every Livemarkup template by
   * extending the `LM.helpers` object.
   *
   *     LM.helpers.shortDate = function(date) {
   *       return moment(date).format('MMMM Do YYYY');
   *     };
   *
   * You can then use them in your views like so:
   *
   *     <div @text='attr("updated_at") -> shortDate(val)'>
   */

  LM.helpers = {};

  /**
   * A template object representing a live DOM instance. The `LM(...)` function
   * returns a template instance. See [LM()] for more info.
   *
   * Has the following attribs:
   *
   *   - $el          : Root element
   *   - directives   : Array of [Directive] instances
   *   - model        : The model bound using [Template#bind()]
   *   - view         : The associed Backbone view when instanciated via `LM(view)`
   *   - localContext : Local object context as modified using [Template#locals()]
   */

  function Template($el) {
    this.$el = $($el);
    this.initialize = _.memoize(this.initialize);
    this.directives = [];
    this.localContext = {};

    // If it's a Backbone view
    if ($el.$el) {
      this.view = $el;
      this.locals('view', $el);
      this.$el = $el.$el;
    }

    if ($el.length > 1) {
      throw new Error("Template can't have more than one root element");
    }
  }

  LM.template = Template;

  /**
   * Sets the target model of the template to the given object.
   *
   *     var model = new Backbone.Model();
   *     tpl.bind(model);
   */

  Template.prototype.bind = function(model) {
    this.model = model;

    return this;
  };

  /**
   * Listens to an event. Usually used as `.on('destroy')` to attach teardown
   * behavior in actions/modifiers.
   *
   *     tpl.on('destroy', function() { ... });
   */

  Template.prototype.on = function() {
    // Let's reuse $el as an event emitter because (1) we don't want a
    // Backbone.Events dependency, (2) `jQuery({})` doesn't work on Zepto.
    //
    // Also, legacy jQuery support (.bind).
    //
    this.$el[on].apply(this.$el, arguments);
  };

  /**
   * Triggers an event to be caught by `.on()`. See [Template#on()].
   * @api private
   */

  Template.prototype.trigger = function() {
    this.$el.trigger.apply(this.$el, arguments);
  };

  /**
   * Renders a template.
   * Updates all directives within a template.
   *
   * In the first time a template is rendered, models will be bound, and
   * directives will be removed from the DOM.
   *
   *     tpl.render();
   */

  Template.prototype.render = function() {
    this.initialize();
    _.each(this.directives, function(dir) { dir.render(); });

    return this;
  };

  /**
   * Passes through the `$el` element, combs out the directives, and binds
   * appropriately.
   *
   * Called on first [Template#render()]. No need to call manually.
   * @api private
   */

  Template.prototype.initialize = function() {
    // Ensure that `lm:destroy` events don't recurse back up to parent templates.
    this.on('lm:destroy', function(e) { e.stopPropagation(); });

    this.directives = Template.fetchDirectives(this.$el, this);

    return this;
  };

  /**
   * Registers some variables as locals.
   *
   *     tpl.locals({ view: myView });
   *
   * You can also use it with a key/value pair:
   *
   *     tpl.locals('view', myView);
   */

  Template.prototype.locals = function(obj) {
    if (typeof obj === 'object') {
      _.extend(this.localContext, obj);
    }

    else if (arguments.length === 2) {
      this.localContext[arguments[0]] = arguments[1];
    }

    return this;
  };

  /**
   * Cleans up and unbinds all events, rendering the template inert.
   *
   * This undoes everything that the [Action]s and [Modifier]s do.
   *
   *     // ...
   *     tpl.destroy();
   *     tpl.$el.remove();
   */

  Template.prototype.destroy = function() {
    this.trigger('lm:destroy');
    return this;
  };

  // ----------------------------------------------------------------------------

  /**
   * Gets a list of text tags. Returns an array of Tag instances.
   * @api private
   */

  Template.fetchDirectives = function(root, template) {
    var directives = [];

    function walk(parent) {
      var stop = false;

      eachAttribute(parent, function(name, value) {
        var d = parseDirective(name, value);
        if (!d) return;

        parent.removeAttribute(name);
        d = new Directive(template, parent, d.action, d.param, d.value);
        directives.push(d);

        if (d._stopped) stop = true;
      });

      if (!stop) {
        var children = []; //parent.children;
        _.each(parent.children, function(child) { children.push(child); });
        _.each(children, function(child) {
          if (child.nodeType === 1) walk(child);
        });

        // for (var i=children.length-1; i>=0; --i) {
        //   var child = children[i];
        //   if (child && child.nodeType === 1) walk(child);
        // }
      }
    }

    walk(root.nodeName ? root : root[0]);

    return directives;
  };

  // ----------------------------------------------------------------------------

  /**
   * A directive.
   *
   * Has the following attributes:
   *
   *  - template     : instance of [Template]
   *  - $el          : element to be worked on
   *  - model        : model to be bound to (alias of [Template#model])
   *  - onrender     : Function to be called on rendering; often overriden in an action
   *  - ondestroy    : Function to be called on [Template#destroy()]
   *  - value        : The attribute value string, raw and unevaluated
   *
   * Actions are ran in the context of an instance of this. Modifiers have
   * access to the directive using `this.directive`.
   */

  function Directive(template, el, action, param, value) {
    this.$el = $(el);
    this.template = template;
    this.model = template.model;
    this.value = value;
    this._stopped = false;

    // Run the action initialization
    getAction(action).apply(this, [param]);
  }

  /**
   * Stops processing down.
   *
   * This prevents the parser from recursing down to the children. Useful for
   * actions where the rest of the block doesn't matter, like `@html` or
   * `@text` (but not `@class` or `@at`).
   */

  Directive.prototype.stop = function() {
    this._stopped = true;
  };

  /**
   * Creates a new expression and runs its modifiers.
   */

  Directive.prototype.expr = function(str) {
    return new Expression(str, this).run();
  };

  /**
   * Refreshes a directive by running its associated action.
   */

  Directive.prototype.render = function() {
    if (this.onrender) this.onrender();
  };

  // ----------------------------------------------------------------------------

  /**
   * Actions.
   *
   * All actions apply to a Directive object.
   */

  var Actions = {};
  LM.actions = Actions;

  /**
   * Text changing action.
   *
   *     <div @text='attr("title")'>
   */

  Actions.text = function() {
    // There's no need to parse out any directives inside it: they will be
    // obliterated anyway.
    this.stop();

    var expr = this.expr(this.value);
    this.onrender = function() { this.$el.text(expr.value()); };
  };

  /**
   * Attribute changing action.
   *
   *     <div @at(type)='attr("type")'>
   */

  Actions.at = function(name) {
    var expr = this.expr(this.value);

    this.onrender = function() {
      var val = expr.value();
      if (val === false) this.$el.removeAttr(name);

      else this.$el.attr(name, val);
    };
  };

  /**
   * Class toggling action.
   *
   *     <div @class:enabled='attr("enabled")'>
   */

  Actions.class = function(className) {
    className = className.replace(/[:\.]/g, ' ');
    var expr = this.expr(this.value);

    this.onrender = function() {
      var val = expr.value();

      this.$el.toggleClass(className, !!val);
    };
  };

  /**
   * HTML setting action.
   *
   * Works exactly like [LM.actions.text], but sets HTML instead.
   *
   *     <div @html='attr("title")'>
   *     <div @html='-> getInstructionHTML()'>
   */

  Actions.html = function() {
    var expr = this.expr(this.value);

    // There's no need to parse out any directives inside it: they will be
    // obliterated anyway.
    this.stop();

    this.onrender = function() {
      this.$el.html(expr.value());
    };
  };

  /**
   * Makes a two-way value binding. Works for `input`, `textarea`, and `select`.
   *
   *     <input @value='attr("name")'>
   */

  Actions.value = function() {
    var dir = this;
    var template = this.template;
    var $el = dir.$el;
    var expr = this.expr(this.value);
    var onchange;

    this.onrender = function() {
      // Get the value and transform it if need be.
      // (Array'ify it because $("select[multiple]").val() expects it, and so
      // does `recheck()`)
      var val = expr.value();

      // Set the value; uncheck the false and check the true.
      if ($el.is(radio + ',' + check))
        recheck($el, toArray(val));

      // Account for <select multiple>
      else if ($el.is(multiple))
        $el.val(toArray(val));

      else
        $el.val(val);

      // Bind an onchange if there's a two-way binding (`attr('...')`).
      // Ensure that it's bound only once (because onrender happens many times!)
      if (dir.attrib && !dir.bound) {
        dir.bound = true;
        $el[on]('change', onchange = function(e, v) {
          dir.attrib.model.set(dir.attrib.field, $(this).val());
        });
      }
    };

    template.on('lm:destroy', function() {
      if (dir.bound) $el[off]('change', onchange);
    });
  };

  /**
   * Makes the element present if the value is `true`, and hides it if `false`.
   *
   *     <div @if='attr("enabled")'>...</div>
   */

  Actions.if = function() {
    this.stop();

    var dir = this;
    var template = dir.template;
    var expr = this.expr(this.value);

    // Create a placeholder empty text code so we know where to ressurrent the
    // element later on.
    var $holder = $(createTextNodeAfter(this.$el));

    // Remove the element so we can append it later on.
    var $blueprint = dir.$el.remove();
    var $el;

    // Render as a subtemplate.
    this.sub = null;

    this.onrender = function() {
      if (expr.value()) {
        $el = $blueprint.clone();
        $holder.after($el);
        if (!this.sub) {
          this.sub = LM($el).locals(template.localContext).bind(template.model).render();
        }
      }
      else {
        if (this.sub) {
          this.sub.destroy();
          delete this.sub;
        }
        if ($el) {
          $el.remove();
          $el = null;
        }
      }
    };

    // Propagate destruction.
    template.on('lm:destroy', function() { dir.sub.destroy(); });
  };

  /**
   * Binds an event handler
   */

  Actions.on = function(event) {
    var dir = this;
    var $el = dir.$el;
    var tpl = dir.template;
    var src = this.value;
    var fn;

    if (tpl.view && tpl.view[src]) {
      // Work with Backbone view methods
      fn = tpl.view[src];
    }
    else {
      // Create a function closure that adds the local context into it
      var gen = new Function('ctx', 'with(ctx){return function(e){'+ src + '};}');
      fn = gen(tpl.localContext);
    }

    // Bind the event
    $el[on](event, fn);
    tpl.on('lm:destroy', function() { $el[off](event, fn); });
  };

  /**
   * Runner.
   * (Does nothing really, since the formatter will run it anyway)
   */

  Actions.run = function() {
    var expr = this.expr(this.value);
    this.onrender = function() { expr.value(); };
  };

  /**
   * Each
   */

  Actions.each = function() {
    this.stop();

    var dir = this;
    var parent = dir.template;
    var $list = dir.$el;
    var $item = $list.children().remove();
    var m = dir.value.match(/^(.*?)(?:,\s*(.*?))? in (.*)$/);
    if (!m) throw new Error("@each: unexpected format");

    var expr = dir.expr(m[3]);
    var valName, keyName;

    if (m[2]) {
      keyName = m[1]; valName = m[2];
    } else {
      valName = m[1];
    }

    if ($item.length !== 1)
      throw new Error("@each: expected only 1 child node, found "+$item.length);

    this.onrender = function() {
      var list = expr.value();

      if (isCollection(list))
        eachCollection(list, $list, $item, valName, keyName, parent, dir);
      else
        eachArray(list, $list, $item, valName, keyName, parent, dir);
    };
  };

  function eachCollection(list, $list, $item, valName, keyName, parent, dir) {
    var view = parent.view;
    var subs = {};

    listenVia(view, parent, list, 'add', add);
    listenVia(view, parent, list, 'reset', reset);
    listenVia(view, parent, list, 'remove', remove);
    listenVia(view, parent, list, 'sort', sort);

    // Reset first if it already has items
    if (list.length) reset(list);

    function add(model) {
      var tpl = append(model);
      tpl.$el.trigger('lm:append');
    }

    function remove(model) {
      var tpl = subs[model.cid];
      if (!tpl) return;

      tpl.destroy();
      var prevented = triggerAndCheck(tpl.$el, 'lm:remove');
      if (!prevented) tpl.$el.remove();
    }

    function reset(models) {
      _.each(subs, function(tpl) {
        tpl.destroy();
        var prevented = triggerAndCheck(tpl.$el, 'lm:remove-reset');
        if (!prevented) tpl.$el.remove();
      });

      models.each(function(model) {
        var tpl = append(model);
        tpl.$el.trigger('lm:append-reset');
      });
      parent.trigger('lm:reset');
    }

    // Sort by re-appending them one-by-one.
    function sort(models) {
      models.each(function(model) {
        var tpl = subs[model.cid];
        if (tpl) $list.append(tpl.$el);
      });
    }

    // Appends a model and triggers it.
    function append(model) {
      // Create a subtemplate.
      var tpl = LM($item.clone());
      tpl.locals(parent.localContext);
      tpl.locals(valName, model);
      tpl.render();

      // Use it.
      $list.append(tpl.$el);
      subs[model.cid] = tpl;
      return tpl;
    }
  }

  function eachArray(list, $list, $item, valName, keyName, parent, dir) {
    _.each(list, function(item, key) {
      // Create a subtemplate.
      var tpl = LM($item.clone()).locals(parent.locals);
      if (keyName) tpl.locals(keyName, key);
      tpl.locals(valName, item);
      tpl.render();

      // Use it.
      $list.append(tpl.$el);

      // Make sure that the subtemplate will clean up.
      parent.on('lm:destroy', function() { tpl.destroy(); });
    });
  }

  // ----------------------------------------------------------------------------

  /**
   * An expression.
   *
   *     var str = "attr('name') -> val.toUpperCase()";
   *
   *     var expr = new Expression(str, dir);
   *
   *     // Actually does the binding to the 'name' attribute
   *     expr.run();
   *
   *     // Shortcut to new Expr().run():
   *     var expr = dir.expr(str);
   *
   *     // Returns the value of the name
   *     expr.value();
   */

  function Expression(code, directive) {
    this.code = Expression.expand(code);
    this.directive = directive;
    this._formatters = [];
  }

  /**
   * Returns the value of an expression.
   */

  Expression.prototype.value = function() {
    var dir = this.directive;

    return _.inject(this._formatters, function(val, fn) {
      return fn.apply(dir, [val]);
    }, null);
  };

  /**
   * Runs the given expression.
   */

  Expression.prototype.run = function() {
    var src = 'with(locals){with(helpers){ctx.' + this.code + ';}}';
    var fn = new Function('ctx', '$el', 'helpers', 'locals', src);
    var ctx = new ExpressionContext(this);
    fn(ctx, this.directive.$el, LM.helpers, this.directive.template.localContext);

    return this;
  };

  /**
   * Expands the shortcuts in the expression code.
   *
   *      expand("attr('n') -> val.toUpperCase()")
   *      // =>  "attr('n').format(function(val) { return (val.toUpperCase()); });"
   *
   * @api private
   */

  Expression.expand = function(code) {
    return code
      .replace(/-> (.*)$/, function(_, fn) {
        return '.format(function(val) { return ('+fn+'); })';
      })
     .replace(/^(\.+)/, '');
  };

  // ----------------------------------------------------------------------------

  function ExpressionContext(expr) {
    this.expression = expr;
    this.directive = expr.directive;
  }

  /**
   * Modifiers.
   *
   * You can access the modifiers as:
   *
   *     LM.modifiers
   *
   * This hosts a bunch of *modifier* functions. Each modifier function is:
   *
   *  - ran on the context of an object that has one attribute: `directive`,
   *  which hosts the directive.
   *
   *  - always does `return this` at the end so they can be chained.
   *
   *  - usually uses `.format()` to make a getter.
   *
   * You can implement your own modifiers like this example here:
   *
   *     LM.modifiers['greet'] = function(name) {
   *       var dir = this.directive;     // a `Directive` object
   *       var model = dir.model;
   *       this.format(function() {      // Make it do the same as `-> "hello world"`
   *         return "Hello world";
   *       });
   *       return this;
   *     }
   */

  var Modifiers = ExpressionContext.prototype;
  LM.modfiers = Modifiers;

  /**
   * Attribute modifier.
   *
   * This is actually a macro that expands to a `.on()` (to listen for change
   * events) and a `.format()` (to do `model.get()`).
   */

  Modifiers.attr = function(model, name) {
    var dir = this.directive;

    if (!name) { name = model; model = null; }
    if (!model) { model = dir.model; }
    if (!model) { throw new Error("attr(): no model to bind to"); }

    // Leave a message for `@value` to pick up
    if (!dir.attrib) {
      dir.attrib = { model: model, field: name };
    }

    // FIXME doesn't support multi
    this.on(model, 'change:'+name);
    this.format(function() { return model.get(name); });

    return this;
  };

  /**
   * Event binding modifier.
   */

  Modifiers.on = function(model, name) {
    var dir = this.directive;
    var template = dir.template;
    var view = template.view;

    if (!name) { name = model; model = null; }
    if (!model) { model = dir.model; }
    if (!model) { throw new Error("on(): no model to bind to"); }

    // Create an event listener to `model`.
    listenVia(view, template, model, name, function() {
      dir.render();
    });

    return this;
  };

  /**
   * Formatter
   */

  Modifiers.format = function(fn) {
    var dir = this.directive;

    // Bind to model if need be.
    var model = dir.model;
    if (model) fn = $.proxy(fn, model);

    this.expression._formatters.push(fn);
    return this;
  };

  // ----------------------------------------------------------------------------
  // Helpers

  return LM;

  /**
   * Iterates through each attribute of a given element.
   *
   * Loop backwards because we remove attributes as we go along; a forward
   * iteration will not be reliable.
   *
   * @api private
   */

  function eachAttribute(node, block) {
    for (var i=node.attributes.length-1; i>=0; --i) {
      var attr = node.attributes[i];
      block(attr.nodeName, attr.nodeValue);
    }
  }

  /**
   * Parses a DOM Attribute (name/value pair) and returns an object hash.
   * The hash has the following things:
   *
   *   - action  : name of action
   *   - param   : params to be passed to action
   *   - value   : the value getter (in JS code string)
   *
   * @api private
   */
  function parseDirective(name, value) {
    var m = name.match(dirMatcher);
    if (!m) return;

    var re = {};
    re.action = m[1];
    re.param = m[2];
    re.value = value;

    return re;
  }

  function createTextNodeAfter($el) {
    var text = document.createTextNode('');
    $el.after(text);
    return text;
  }

  /**
   * Finds an action of a given name and returns it.
   * @api private
   */

  function getAction(name) {
    var action = LM.actions[name.toLowerCase()];
    if (!action) { throw new Error("Livemarkup: No action named '"+name+"'"); }

    return action;
  }

  /**
   * Given a checkbox or radio `$element`, deselect its bretheren and only
   * select the ones in `[val]`.
   *
   * Essentially, it makes a bunch of radio/checkboxes work just like
   * `$("select[multiple]").val([a, b, c]);`.
   *
   * @api private
   */

  function recheck($element, val) {
    var name = $element.attr('name');
    var scope = $element.closest('form,:root').find('[name="'+name+'"]');

    // Values selector
    var values = _.map(val, function(v) { return '[value="' + v + '"]'; }).join(',');

    if ($.fn.prop) {
      scope.filter(':checked').prop('checked', false);
      scope.filter(values).prop('checked', true);
    }
    
    else {
      // jQuery <=1.5
      scope.filter(':checked').removeAttr('checked');
      scope.filter(values).attr('checked', true);
    }
  }

  /**
   * Converts a given `value` to an array.
   * @api private
   */

  function toArray(value) {
    if (typeof value === 'undefined') return [];
    return _.isArray(value) ? value : [value];
  }

  /**
   * Checks if a given list responds like a Backbone.js collection.
   * @api private
   */

  function isCollection(list) {
    return list.each && list.on;
  }

  /**
   * Listen to event `event` in `model` and call `callback`.
   *
   * If a `view` is available, use Backbone's `listenTo()` facility so that
   * removing a view will stop any events.  Otherwise, listen normally as you
   * would.
   *
   * @api private
   */

  function listenVia(view, template, model, event, callback) {
    if (view && view.listenTo) {
      view.listenTo(model, event, callback);
      template.on('lm:destroy', function() { view.stopListening(model, event, callback); });
    } else {
      model.on(event, callback);
      template.on('lm:destroy', function() { model.off(event, callback); });
    }
  }

  // Triggers and event and returns if the default was prevented.
  function triggerAndCheck($el, eventName) {
    var e = $.Event(eventName);
    $el.trigger(e);
    return e.isDefaultPrevented();
  }

}(this.jQuery || this.Zepto || this.ender, _));
