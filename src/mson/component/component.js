import events from 'events';
import _ from 'lodash';

let nextKey = 0;
const getNextKey = () => {
  return nextKey++;
};

// NOTE:
// - Get and set designed so that easy to add functionality later on set and get, including via
//   event listeners
// - The props are placed directly on this object as opposed to onto say a "_props" field. This has
//   the advantage of making it less verbose to access, e.g. comp._foo instead of comp._props.foo.
// - We attempted to require all access to all props via get() and set(), but this can cause
//   infinite recursion, e.g. when a get() calls itself either directly or via some inherited logic.
export default class Component extends events.EventEmitter {
  _getComponentMSONSchema() {
    return {
      component: 'Form',
      fields: [
        {
          // This field is just for the MSON definition
          name: 'component',
          component: 'TextField'
          // required: true
        },
        {
          name: 'name',
          component: 'TextField',
          required: true
        },
        // TODO: listeners
        {
          name: 'schema',
          component: 'FormField',
          form: {
            // TODO: should there be a SchemaForm?
            component: 'ObjectForm'
          }
        }
      ]
    };
  }

  constructor(props) {
    super(props);

    // We have to set the name before we create the component as the name be needed to create the
    // component, e.g. to create sub fields using the name as a prefix.
    if (props) {
      this._setName(props);
    }

    this._create(props === undefined ? {} : props);
    this.set(props === undefined ? {} : props);

    // Emit the create event after we have set up the initial listeners
    this._emitChange('create');

    // Used to create a separate namespace/keyspace for components so that we can do things like
    // trigger a UI update in frameworks like React.
    this._key = getNextKey();
  }

  _create(/* props */) {
    // TODO: would it be better if the schema was loaded dynamically and on demand instead of
    // whenever the component is created? In some ways we already have this the schema exists as
    // simple objects until it instantiated. The problem with a lazy setting of the schema is how we
    // would allow schemas to be defined via MSON.
    this.set({ schema: this._getComponentMSONSchema() });
  }

  _emitChange(name, value) {
    this.emit(name, value);
    this.emit('$change', name, value);
  }

  _set(name, value) {
    // Is the value changing? Preventing emitting when the value doesn't change. We don't currently
    // initialize the props to null so we ignore any changes where the prop would switch from
    // undefined to null.
    if (
      this['_' + name] !== value &&
      (this['_' + name] !== undefined || value !== null)
    ) {
      this['_' + name] = value;
      this._emitChange(name, value);
    }
  }

  _push(name, value) {
    let values = this._get(name);
    if (!Array.isArray(values)) {
      values = [];
    }
    values.push(value);
    this._set(name, values);
  }

  _setIfUndefinedProp(props, name) {
    if (props[name] !== undefined) {
      this._set(name, props[name]);
    }
  }

  _setIfUndefined(props, ...names) {
    names.forEach(name => {
      this._setIfUndefinedProp(props, name);
    });
  }

  _setName(props) {
    this._setIfUndefinedProp(props, 'name');
  }

  _setPassed(props) {
    this._setIfUndefinedProp(props, 'passed');
  }

  // TODO: use this in _create() instead of set() for defaults
  _setDefaults(props, values) {
    _.each(values, (value, name) => {
      if (props[name] === undefined) {
        this._set(name, value);
      }
    });
  }

  _emitCreatedFactory = () => {
    this._emitChange('created');
  };

  _emitLoadedFactory = () => {
    this._emitChange('loaded');
  };

  _setListeners(props) {
    let hasOnCreate = false;
    let hasOnLoad = false;

    // Emit loaded event after all actions for the load event have been emitted so that we can
    // guarantee that data has been loaded.

    // Clear any previous listener to prevent memory leaks
    this.removeListener('create', this._emitCreatedFactory);
    this.removeListener('load', this._emitLoadedFactory);

    if (props.listeners !== undefined) {
      // Inject ifData so that we don't have to explicitly define it in the actions
      const ifData = props.passed;

      // TODO: when the listeners change need to clean up previous listeners to prevent a listener
      // leak
      this._setIfUndefinedProp(props, 'listeners');
      props.listeners.forEach(listener => {
        this.on(listener.event, async () => {
          let output = null;
          for (const i in listener.actions) {
            const action = listener.actions[i];

            // Pass the previous action's output as this actions arguments
            output = await action.run({
              event: listener.event,
              component: this,
              ifData,
              arguments: output
            });
          }

          switch (listener.event) {
            case 'create':
              hasOnCreate = true;
              this._emitCreatedFactory();
              break;
            case 'load':
              hasOnLoad = true;
              this._emitLoadedFactory();
              break;
            default:
              break;
          }
        });
      });
    }

    if (!hasOnCreate) {
      this.on('create', this._emitCreatedFactory);
    }
    if (!hasOnLoad) {
      this.on('load', this._emitLoadedFactory);
    }
  }

  set(props) {
    if (typeof props !== 'object') {
      throw new Error('props must be an object');
    }
    this._setName(props);
    this._setListeners(props);
    this._setPassed(props);

    if (props.schema !== undefined) {
      // Schemas are pushed that they can accumulate through the layers of inheritance
      this._push('schema', props.schema);
    }
  }

  _get(name) {
    // Default to null if the prop has not yet been defined
    return this['_' + name] === undefined ? null : this['_' + name];
  }

  _getIfAllowed(name, ...allowedNames) {
    if (allowedNames.indexOf(name) !== -1) {
      return this._get(name);
    }
  }

  getOne(name) {
    return this._getIfAllowed(name, 'name', 'listeners', 'passed', 'schema');
  }

  get(names) {
    if (!names) {
      // Get all props
      let values = {};
      _.each(this, (value, name) => {
        const n = name.replace('_', '');
        values[n] = this.getOne(n);
      });
      return values;
    } else if (Array.isArray(names)) {
      // Get multiple props
      let values = {};
      names.forEach(name => {
        values[name] = this.getOne(name);
      });
      return values;
    } else if (names) {
      // Get single prop
      return this.getOne(names);
    }
  }

  getClassName() {
    if (this._className) {
      // The component was generated via MSON and so the contructor.name is inaccurate
      return this._className;
    } else {
      return this.constructor.name;
    }
  }

  clone() {
    const clonedComponent = _.cloneDeep(this);

    // Remove all listeners and expect new ones to be set up so that we don't have duplicate
    // listeners
    clonedComponent.removeAllListeners();

    return clonedComponent;
  }

  // This should be called whenever the route changes and the component is loaded
  emitLoad() {
    this._emitChange('load');
  }

  _bubbleUpEvents(component, events) {
    events.forEach(event => {
      component.on(event, value => {
        this._emitChange(event, value);
      });
    });
  }

  getKey() {
    return this._key;
  }

  // Set properties on another component. Useful for nested components
  _setOn(component, props, propNames) {
    propNames.forEach(name => {
      if (props[name] !== undefined) {
        component.set({ [name]: props[name] });
      }
    });
  }

  // Get properties from another component. Useful for nested components
  _getFrom(component, name, propNames) {
    if (propNames.indexOf(name) !== -1) {
      return component.get(name);
    }
  }

  buildSchemaForm(form, compiler) {
    const schemas = this.get('schema');
    if (schemas) {
      schemas.forEach(schema => {
        const schemaForm = compiler.newComponent(schema);
        form.copyFields(schemaForm);
      });
    }
  }
}
