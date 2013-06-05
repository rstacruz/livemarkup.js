/*! Livemarkup.js -- ricostacruz.com/livemarkup
    (c) 2013, MIT licensed */

(function(lm) {
  if (typeof module === 'object') module.exports = lm;
  else this.LM = lm;
})(function($, _) {

  /**
   * Returns a template object.
   *
   *     var $div = $("...");
   *     LM($div);
   *
   * `LM(element)` is an alias for `new LM.template(element)` -- see [Template]
   * documentation for more details.
   */

  var LM = function(element) {
    return new Template(element);
  };

  /**
   * A template object representing a live DOM instance.
   *
   *     var $div = $("#my_template");
   *     var tpl = new LM.template($div)
   *      .bind(model)
   *      .locals({ view: view })
   *      .render();
   */

  function Template($el) {
    this.$el = $el;
    this.initialize = _.memoize(this.initialize);
    this.directives = [];
    this.localContext = {};
    this.events = $({}); // Event emitter for `.on()` and `.trigger()`

    // If it's a Backbone view
    if ($el.$el) {
      this.view = $el;
      this.locals('view', $el);
      this.$el = $el.$el;
    }
  }

  LM.template = Template;

  /**
   * Root element.
   */

  Template.prototype.$el = null;

  /**
   * Array of [Directive] instances.
   */

  Template.prototype.directives = null;

  /**
   * The model bound using [Template#bind()].
   */

  Template.prototype.model = null;

  /**
   * Backbone view associated.
   */

  Template.prototype.view = null;

  /**
   * The local context as modified using [Template#locals()].
   */

  Template.prototype.localContext = null;

  /**
   * Sets the target model of the template to the given object.
   */

  Template.prototype.bind = function(model) {
    this.model = model;

    return this;
  };

  Template.prototype.on = function() {
    this.events.on.apply(this.events, arguments);
  };

  Template.prototype.trigger = function() {
    this.events.trigger.apply(this.events, arguments);
  };

  /**
   * Renders a template.
   * Updates all directives within a template.
   *
   * In the first time a template is rendered, models will be bound, and
   * directives will be removed from the DOM.
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
   *
   * @api private
   */

  Template.prototype.initialize = function() {
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
   * This undoes everything that an [Action] does.
   */

  Template.prototype.destroy = function() {
    this.trigger('destroy');
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
        _.each(parent.children, function(child) {
          if (child.nodeType === 1) walk(child);
        });
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
   */

  function Directive(template, el, action, param, value) {
    this.$el = $(el);
    this.template = template;
    this.model = template.model;
    this.formatters = [];
    this._stopped = false;

    getAction(action).apply(this, [param]);

    // Build the runner
    var code = 'ctx.' + value + ';';
    code = 'with(locals){with(helpers){' + code + '}}';
    var fn = new Function('ctx', '$el', 'helpers', 'locals', code);

    // Run it
    var ctx = new Context(this);
    fn(ctx, this.$el, LM.helpers, template.localContext);
  }

  /**
   * Reference to parent [Template].
   */
  Directive.prototype.template = null;

  /**
   * Reference to model in the template. Equivalent to `template.model`.
   */
  Directive.prototype.model = null;

  /**
   * List of formatter functions.
   */
  Directive.prototype.formatters = null;

  /**
   * Function to be called on rendering. Usually overridden in an action.
   */
  Directive.prototype.onrender = null;

  /**
   * Function to be called when destroying ([Template#destroy()]). Usually
   * overridden in an action.
   */
  Directive.prototype.ondestroy = null;

  /**
   * Stops processing down.
   */

  Directive.prototype.stop = function() {
    this._stopped = true;
  };

  /**
   * Returns the value of a given directive.
   *
   * Runs all the `getter` functions (as set by the modifiers) and returns the
   * final value.
   */

  Directive.prototype.getValue = function() {
    var dir = this;

    return _.inject(this.formatters, function(val, fn) {
      return fn.apply(dir, [val]);
    }, null);
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

    this.onrender = function() { this.$el.text(this.getValue()); };
  };

  /**
   * Attribute changing action.
   *
   *     <div @at(type)='attr("type")'>
   */

  Actions.at = function(name) {
    this.onrender = function() {
      var val = this.getValue();
      if (val === false) this.$el.removeAttr(name);

      else this.$el.attr(name, val);
    };
  };

  /**
   * Class toggling action.
   *
   *     <div @class(enabled)='attr("enabled")'>
   */

  Actions.class = function(className) {
    className = className.replace(/\./g, ' ');

    this.onrender = function() {
      var val = this.getValue();

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
    // There's no need to parse out any directives inside it: they will be
    // obliterated anyway.
    this.stop();

    this.onrender = function() {
      this.$el.html(this.getValue());
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
    var onchange;
    var scope = dir.$el;

    // For things that have multiple, you need to array'ify your values.
    var isMulti = scope.is(':radio,:checkbox,select[multiple]');

    // For multiples, make it work with its bretheren as well
    if (scope.is(':radio,:checkbox')) {
      var name = scope.attr('name');
      scope = scope.closest('form,:root').find('[name="'+name+'"]');
    }

    this.onrender = function() {
      // Get the value and transform it if need be.
      val = dir.getValue();
      if (isMulti && !_.isArray(val)) val = [val];

      // Set the value.
      scope.val(val);

      // Bind an onchange.
      if (dir.attrib && !dir.bound) {
        dir.bound = true;
        scope.on('change', onchange = function(e, v) {
          dir.attrib.model.set(dir.attrib.field, scope.val());
        });
      }
    };

    template.on('destroy', function() {
      dir.$el.off('change', onchange);
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
    var template = this.template;

    // Create a placeholder empty text code so we know where to ressurrent the
    // element later on.
    var $holder = $(createTextNodeAfter(this.$el));

    // Remove the element so we can append it later on.
    var $el = this.$el.remove();

    // Render as a subtemplate.
    this.sub = LM($el).locals(template.localContext).bind(template.model);

    this.onrender = function() {
      if (this.getValue()) {
        $holder.after($el);
        this.sub.render();
      }
      else {
        this.sub.destroy();
        $el.remove();
      }
    };

    // Propagate destruction.
    template.on('destroy', function() { dir.sub.destroy(); });
  };

  // ----------------------------------------------------------------------------

  function Context(dir) {
    this.directive = dir;
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

  var Modifiers = Context.prototype;
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

    // The callback to run when a model's event is triggered.
    var fn = function() { dir.render(); };

    // If a view is available, use Backbone's `listenTo()` facility so that
    // removing a view will stop any events.
    if (view && view.listenTo) {
      view.listenTo(model, name, fn);
      dir.template.on('destroy', function() { view.stopListening(model, name, fn); });
    }
    
    // Otherwise, listen normally as you would.
    else {
      model.on(name, fn);
      dir.template.on('destroy', function() { model.off(name, fn); });
    }

    return this;
  };

  Modifiers.format = function(fn) {
    var dir = this.directive;

    // Bind to model if need be.
    var model = dir.model;
    if (model) fn = $.proxy(fn, model);

    dir.formatters.push(fn);
    return this;
  };

  // ----------------------------------------------------------------------------
  // Helpers

  /**
   * Helpers
   */

  LM.helpers = {};

  return LM;

  /**
   * Iterates through each attribute of a given element.
   * @api private
   */

  function eachAttribute(node, block) {
    _.each(node.attributes, function(attr) {
      block(attr.nodeName, attr.nodeValue);
    });
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
    var m = name.match(/^@([a-zA-Z0-9\_]+)(?:\(([^\)]+)\))?$/);
    if (!m) return;

    var re = {};
    re.action = m[1];
    re.param = m[2];
    re.value = value
      .replace(/-> (.*)$/, function(_, fn) {
        return '.format(function(val) { return ('+fn+'); })';
      })
     .replace(/^(\.+)/, '');

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


}(jQuery || Zepto || ender, _));
