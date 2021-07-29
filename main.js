'use strict';

/*
 * Created with @iobroker/create-adapter v1.26.3
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");
const request = require('request');

//global variables
let adapter;
let config;
let main_interval;
let reset_job;

class QcellsQhomeEssHybG2 extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'qcells-qhome-ess-hyb-g2',
        });
        this.on('ready', this.onReady.bind(this));
        //this.on('stateChange', this.onStateChange.bind(this));
        //this.on('objectChange', this.onObjectChange.bind(this));
        //this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        //load Config
        adapter = this;
        config = adapter.config;

        //Create States
        await adapter.create_states();

        //Intervall berechnen
        var interval = config.uptInterval * 1000;

        //Daten abrufen
        try {
            main_interval = setInterval(async function () {
                //URL
                var urlAPI = 'http://' + config.hostname + '/R3EMSAPP_REAL.ems?file=ESSRealtimeStatus.json';

                //Daten abrufen
                request(urlAPI, function (err, state, body) {
                    //JSON in Array umwandeln
                    var arrValues = JSON.parse(body);
                    //JSON in Array umwandeln
                    var arrValues = JSON.parse(body);

                    //Batterieladung in kWh berechnen
                    var BtSoc = parseFloat(arrValues.ESSRealtimeStatus.BtSoc)
                    var BtCap = config.batCapacity * BtSoc / 100;

                    //Datenpunkte aktualisieren
                    adapter.setState('ColecTm', { val: adapter.transform_Timestamp(arrValues.ESSRealtimeStatus.ColecTm), ack: true });
                    adapter.setState('PowerOutletPw', { val: parseInt(arrValues.ESSRealtimeStatus.PowerOutletPw), ack: true });
                    adapter.setState('GridPw', { val: parseFloat(arrValues.ESSRealtimeStatus.GridPw), ack: true });
                    adapter.setState('ConsPw', { val: parseFloat(arrValues.ESSRealtimeStatus.ConsPw), ack: true });
                    adapter.setState('BtSoc', { val: BtSoc, ack: true });
                    adapter.setState('PcsPw', { val: arrValues.ESSRealtimeStatus.PcsPw, ack: true });
                    adapter.setState('AbsPcsPw', { val: arrValues.ESSRealtimeStatus.AbsPcsPw, ack: true });
                    adapter.setState('PvPw', { val: parseFloat(arrValues.ESSRealtimeStatus.PvPw), ack: true });
                    adapter.setState('GridStusCd', { val: parseInt(arrValues.ESSRealtimeStatus.GridStusCd), ack: true });
                    adapter.setState('BtStusCd', { val: parseInt(arrValues.ESSRealtimeStatus.BtStusCd), ack: true });
                    adapter.setState('BtPw', { val: parseFloat(arrValues.ESSRealtimeStatus.BtPw), ack: true });
                    adapter.setState('OperStusCd', { val: parseInt(arrValues.ESSRealtimeStatus.OperStusCd), ack: true });
                    adapter.setState('EmsOpMode', { val: parseInt(arrValues.ESSRealtimeStatus.EmsOpMode), ack: true });
                    adapter.setState('RankPer', { val: parseInt(arrValues.ESSRealtimeStatus.RankPer), ack: true });
                    adapter.setState('ErrorCnt', { val: arrValues.ESSRealtimeStatus.ErrorCnt, ack: true });
                    adapter.setState('BtCap', { val: BtCap, ack: true });
                    adapter.setState('BtLast', { val: BtLast, ack: true });
                })
            }, interval);
        } catch (ex) {
            adapter.log.error(ex.message);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearInterval(main_interval)
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    //Convert Timestamp
    transform_Timestamp(input) {
        return new Date(input.toString().replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$4:$5:$6 $2/$3/$1')).toLocaleString()
    };

    //Create States
    async create_states() {
        await adapter.setObjectNotExistsAsync('AbsPcsPw', {
            type: 'state',
            common: {
                name: 'Wechselrichterleistung absolut',
                type: 'number',
                def: 0,
                unit: 'kW'
            }
        });

        await adapter.setObjectNotExistsAsync('BtCap', {
            type: 'state',
            common: {
                name: 'Batterie Kapazität',
                type: 'number',
                def: 0,
                unit: 'kWh'
            }
        });

        await adapter.setObjectNotExistsAsync('BtPw', {
            type: 'state',
            common: {
                name: 'Batterieleistung',
                type: 'number',
                def: 0,
                unit: 'kW'
            }
        });

        await adapter.setObjectNotExistsAsync('BtSoc', {
            type: 'state',
            common: {
                name: 'Batterie Ladezustand',
                type: 'number',
                def: 0,
                unit: '%'
            }
        });

        await adapter.setObjectNotExistsAsync('BtStusCd', {
            type: 'state',
            common: {
                name: 'Batteriestatuscode',
                type: 'number',
                unit: '',
                states: {
                    '0': 'Entladen',
                    '1': 'Laden',
                    '2': 'Geladen'
                }
            }
        });

        await adapter.setObjectNotExistsAsync('BtLast', {
            type: 'state',
            common: {
                name: 'Restlaufzeit (laden/entladen)',
                type: 'number',
                def: 0,
                unit: 'Min'
            }
        });

        await adapter.setObjectNotExistsAsync('ColecTm', {
            type: 'state',
            common: {
                name: 'Abfragezeitpunkt',
                type: 'string',
                def: '',
                unit: ''
            }
        });

        await adapter.setObjectNotExistsAsync('ConsPw', {
            type: 'state',
            common: {
                name: 'Bedarf Leistung',
                type: 'number',
                def: 0,
                unit: 'kW'
            }
        });

        await adapter.setObjectNotExistsAsync('EmsOpMode', {
            type: 'state',
            common: {
                name: 'Bedarf Leistung',
                type: 'number',
                def: 0,
                unit: ''
            }
        });

        await adapter.setObjectNotExistsAsync('ErrorCnt', {
            type: 'state',
            common: {
                name: 'Anzahl Fehler',
                type: 'number',
                def: 0,
                unit: ''
            }
        });

        await adapter.setObjectNotExistsAsync('GridPw', {
            type: 'state',
            common: {
                name: 'Netzleistung',
                type: 'number',
                def: 0,
                unit: 'kW'
            }
        });

        await adapter.setObjectNotExistsAsync('GridStusCd', {
            type: 'state',
            common: {
                name: 'Netzstatuscode',
                type: 'number',
                unit: '',
                def: '',
                states: {
                    '0': 'Bezug',
                    '1': 'Einspeisung'
                }
            }
        });

        await adapter.setObjectNotExistsAsync('OperStusCd', {
            type: 'state',
            common: {
                name: 'OperStusCd',
                type: 'number',
                def: '',
                unit: ''
            }
        });

        await adapter.setObjectNotExistsAsync('PcsPw', {
            type: 'state',
            common: {
                name: 'Wechselrichterleistung',
                type: 'number',
                def: 0,
                unit: 'W'
            }
        });

        await adapter.setObjectNotExistsAsync('PowerOutletPw', {
            type: 'state',
            common: {
                name: 'PowerOutletPw',
                type: 'number',
                def: 0,
                unit: ''
            }
        });

        await adapter.setObjectNotExistsAsync('PvPw', {
            type: 'state',
            common: {
                name: 'Photovoltaikleistung',
                type: 'number',
                def: 0,
                unit: 'kW'
            }
        });

        await adapter.setObjectNotExistsAsync('RankPer', {
            type: 'state',
            common: {
                name: 'RankPer',
                type: 'number',
                unit: ''
            }
        });
    };
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new QcellsQhomeEssHybG2(options);
} else {
    // otherwise start the instance directly
    new QcellsQhomeEssHybG2();
}