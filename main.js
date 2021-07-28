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
const schedule = require('node-schedule');

//global variables
let adapter;
let config;
let main_interval;
let job;
let resetMeterReadings;

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
        // this.on('objectChange', this.onObjectChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
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

        //Reset Trigger initialisieren
        resetMeterReadings = false;
        var interval = config.uptInterval * 1000;

        //Daten abrufen
        try {
            main_interval = setInterval(function () {
                //URL
                var urlAPI = 'http://' + config.hostname + '/R3EMSAPP_REAL.ems?file=ESSRealtimeStatus.json';

                //Daten abrufen
                request(urlAPI, function (err, state, body) {
                    //JSON in Array umwandeln
                    var arrValues = JSON.parse(body);

                    //Batterieladung in kWh berechnen
                    var BtSoc = parseFloat(arrValues.ESSRealtimeStatus.BtSoc)
                    var BtCap = config.batCapacity * BtSoc / 100;

                    //Verbleibende Batterielaufzeit berechnen
                    var BtStusCd = parseInt(arrValues.ESSRealtimeStatus.BtStusCd);
                    var ConsPw = parseFloat(arrValues.ESSRealtimeStatus.ConsPw);
                    var BtPw = parseFloat(arrValues.ESSRealtimeStatus.BtPw);

                    //Tageswerte
                    var PvPw = parseFloat(arrValues.ESSRealtimeStatus.PvPw);
                    var GridStusCd = parseInt(arrValues.ESSRealtimeStatus.GridStusCd);
                    var GridPw = parseFloat(arrValues.ESSRealtimeStatus.GridPw);

                    //Durchschnittsbedarf berechnen
                    var avgCons = adapter.calculate_avgCons(ConsPw);

                    //Batterielaufzeit
                    var BtLast = 0;

                    switch (BtStusCd) {
                        //Entladen
                        case 0:
                            BtLast = Math.round(BtCap / BtPw * 60);
                            break;
                        //Laden
                        case 1:
                            BtLast = Math.round((config.batCapacity - BtCap) / BtPw * 60);
                            break;
                        //Geladen
                        case 2:
                            BtLast = Math.round(BtCap / avgCons * 60);
                            break;
                    }

                    //Datenpunkte aktualisieren
                    adapter.setState('ColecTm', { val: adapter.transform_Timestamp(arrValues.ESSRealtimeStatus.ColecTm), ack: true });
                    adapter.setState('PowerOutletPw', { val: parseInt(arrValues.ESSRealtimeStatus.PowerOutletPw), ack: true });
                    adapter.setState('GridPw', { val: GridPw, ack: true });
                    adapter.setState('ConsPw', { val: ConsPw, ack: true });
                    adapter.setState('BtSoc', { val: BtSoc, ack: true });
                    adapter.setState('PcsPw', { val: arrValues.ESSRealtimeStatus.PcsPw, ack: true });
                    adapter.setState('AbsPcsPw', { val: arrValues.ESSRealtimeStatus.AbsPcsPw, ack: true });
                    adapter.setState('PvPw', { val: PvPw, ack: true });
                    adapter.setState('GridStusCd', { val: GridStusCd, ack: true });
                    adapter.setState('BtStusCd', { val: BtStusCd, ack: true });
                    adapter.setState('BtPw', { val: BtPw, ack: true });
                    adapter.setState('OperStusCd', { val: parseInt(arrValues.ESSRealtimeStatus.OperStusCd), ack: true });
                    adapter.setState('EmsOpMode', { val: parseInt(arrValues.ESSRealtimeStatus.EmsOpMode), ack: true });
                    adapter.setState('RankPer', { val: parseInt(arrValues.ESSRealtimeStatus.RankPer), ack: true });
                    adapter.setState('ErrorCnt', { val: arrValues.ESSRealtimeStatus.ErrorCnt, ack: true });
                    adapter.setState('BtCap', { val: BtCap, ack: true });
                    adapter.setState('BtLast', { val: BtLast, ack: true });
                    adapter.setState('AvgCons', { val: avgCons, ack: true });

                    //Tageswerte aktualisieren
                    adapter.update_meter_readings(PvPw, GridStusCd, GridPw, BtStusCd, BtPw);
                });
            }, interval);
        } catch (ex) {
            adapter.log.error(ex.message);
        }

        job = schedule.scheduleJob('{"time":{"exactTime":true,"start":"23:59"},"period":{"days":1}}', adapter.reset_meter_readings);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearInterval(main_interval)
            job.cancel();
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

    //Setzt die Zählerstände zurück
    reset_meter_readings() {
        resetMeterReadings = true;
    }

    //Durchschnittsbdarf berechnen
    calculate_avgCons(ConsPw) {
        var ConsData = [];

        adapter.log.warn('Versuche ConsData zu lesen..');
        adapter.getState('ConsData', function(err, result){
            if (err) {
                adapter.log.error(err);
            } else {
                ConsData = result.val;
            }
        });

        // try {
        //     adapter.log.warn('Versuche ConsData zu lesen..');
        //     ConsData = adapter.getState(adapter.name + adapter.instance + 'ConsData').val;

        //     if (ConsData) {
        //         ConsData = JSON.parse(ConsData);
        //     }
        // } catch (ex) {
        //     adapter.log.error(ex.message);
        // }

        //Wenn aktueller Bedarf > 0 ist
        if (ConsPw > 0) {
            //Wenn Zeitraum erfüllt, erstes Element löschen
            while (ConsData.length >= (config.avgDuration * 60 / config.uptIntervall)) {
                ConsData.shift();
            };

            //aktuellen Verbrauch dem Array anhängen
            ConsData.push(ConsPw);
        }

        //Durchschnittsverbrauch berechnen
        var totalCons = 0;
        for (let i = 0; i < ConsData.length; i++) {
            totalCons += ConsData[i];
        };

        var avgCons = Math.round(totalCons / ConsData.length * 100) / 100;
        adapter.log.debug('Summe Verbrauch: ' + Math.round(totalCons * 100) / 100 + '; Anzahl Werte: ' + ConsData.length + '; Dauer: ' + (Math.round((ConsData.length * 2 / 60) * 100) / 100) + ' Min' + '; Durchschnitt: ' + avgCons + '; aktueller Verbrauch: ' + ConsPw)

        //Aktuelle Werte in Datenpunkten speichern
        adapter.setState('ConsData', { val: JSON.stringify(ConsData), ack: true });
        return avgCons;
    };

    //Zählerstände aktualisieren
    update_meter_readings(PvPw, GridStusCd, GridPw, BtStusCd, BtPw) {
        var TodayGen = 0;
        var TodayDemand = 0;
        var TodayFeedIn = 0;
        var TodayCharged = 0;
        var TodayDischarged = 0;

        try {
            adapter.log.warn('Versuche Tageswerte zu lesen..');
            TodayGen = parseFloat(adapter.getState('TodayGen').val)
            TodayDemand = parseFloat(adapter.getState('TodayDemand').val);
            TodayFeedIn = parseFloat(adapter.getState('TodayFeedIn').val);
            TodayCharged = parseFloat(adapter.getState('TodayCharged').val);
            TodayDischarged = parseFloat(adapter.getState('TodayDischarged').val);
        } catch (ex) {
            adapter.log.error(ex.message);
        }

        //Zählerstände speichern und zurücksetzen
        if (resetMeterReadings) {
            resetMeterReadings = false;

            if (config.saveMeterValuesToDb) {
                adapter.save_Meter_Values_to_db(TodayGen, TodayDemand, TodayFeedIn, TodayCharged, TodayDischarged);
            };

            TodayGen = 0;
            TodayDemand = 0;
            TodayFeedIn = 0;
            TodayCharged = 0;
            TodayDischarged = 0;
        }

        TodayGen += (PvPw / (60 * 60)) * config.uptIntervall;

        switch (GridStusCd) {
            //Demand
            case 0:
                TodayDemand += (GridPw / (60 * 60)) * config.uptIntervall;
                break;
            //FeedIn
            case 1:
                TodayFeedIn += (GridPw / (60 * 60)) * config.uptIntervall;
                break;
        }

        switch (BtStusCd) {
            //Entladen
            case 0:
                TodayDischarged += (BtPw / (60 * 60)) * config.uptIntervall;
                break;
            //Laden
            case 1:
                TodayCharged += (BtPw / (60 * 60)) * config.uptIntervall;
                break;
        }

        //Kosten/Erlöse berechnen
        var TodayCost = TodayDemand * config.pBuy;
        var TodayEarn = TodayFeedIn * config.pSell;

        adapter.setState('TodayGen', { val: TodayGen, ack: true });
        adapter.setState('TodayDemand', { val: TodayDemand, ack: true });
        adapter.setState('TodayFeedIn', { val: TodayFeedIn, ack: true });
        adapter.setState('TodayCharged', { val: TodayCharged, ack: true });
        adapter.setState('TodayDischarged', { val: TodayDischarged, ack: true });
        adapter.setState('TodayCost', { val: TodayCost, ack: true });
        adapter.setState('TodayEarn', { val: TodayEarn, ack: true });
    };

    //Convert Timestamp
    transform_Timestamp(input) {
        return new Date(input.toString().replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$4:$5:$6 $2/$3/$1')).toLocaleString()
    };

    //Datenbanktabelle anlegen
    create_db_table() {
        var qry = 'CREATE TABLE IF NOT EXISTS ' + config.dbName + '.' + config.dbTable + ' ( Timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, TodayGen float NOT NULL, TodayDemand float NOT NULL, TodayFeedIn float NOT NULL, TodayCharged float NOT NULL, TodayDischarged float NOT NULL, PRIMARY KEY (timestamp) ) ENGINE=InnoDB DEFAULT CHARSET=utf8;';

        adapter.sendTo(config.SQL_Instanz, 'query', qry, function (result) {
            if (result.error) {
                adapter.log.warn(result.error)
            } else {
                adapter.log.info('Rows: ' + JSON.stringify(result.result))
            }
        });
    }

    //Zählerstände in SQL-Datenbank speichern
    save_Meter_Values_to_db(TodayGen, TodayDemand, TodayFeedIn, TodayCharged, TodayDischarged) {
        var qry = 'INSERT INTO ' + config.dbName + '.' + config.dbTable + ' ( TodayGen, TodayDemand, TodayFeedIn, TodayCharged, TodayDischarged ) VALUES ( ' + TodayGen + ', ' + TodayDemand + ', ' + TodayFeedIn + ', ' + TodayCharged + ', ' + TodayDischarged + ' );';

        adapter.sendTo(config.SQL_Instanz, 'query', qry, function (result) {
            if (result.error) {
                adapter.log.warn(result.error)
            } else {
                adapter.log.debug('Rows: ' + JSON.stringify(result.result))
            }
        });
    }

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

        await adapter.setObjectNotExistsAsync('AvgCons', {
            type: 'state',
            common: {
                name: 'Durchschnittsbedarf',
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

        await adapter.setObjectNotExistsAsync('BtLast', {
            type: 'state',
            common: {
                name: 'Restlaufzeit (laden/entladen)',
                type: 'number',
                def: 0,
                unit: 'Min'
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

        await adapter.setObjectNotExistsAsync('ColecTm', {
            type: 'state',
            common: {
                name: 'Abfragezeitpunkt',
                type: 'string',
                def: '',
                unit: ''
            }
        });

        await adapter.setObjectNotExistsAsync('ConsData', {
            type: 'state',
            common: {
                name: 'Verbrauchswerte Durchschnittsverbrauch',
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

        await adapter.setObjectNotExistsAsync('TodayDemand', {
            type: 'state',
            common: {
                name: 'Heute bezogen',
                type: 'number',
                def: 0,
                unit: 'kWh'
            }
        });

        await adapter.setObjectNotExistsAsync('TodayFeedIn', {
            type: 'state',
            common: {
                name: 'Heute eingespeist',
                type: 'number',
                def: 0,
                unit: 'kWh'
            }
        });

        await adapter.setObjectNotExistsAsync('TodayGen', {
            type: 'state',
            common: {
                name: 'Heute generiert',
                type: 'number',
                def: 0,
                unit: 'kWh'
            }
        });

        await adapter.setObjectNotExistsAsync('TodayCharged', {
            type: 'state',
            common: {
                name: 'Heute geladen',
                type: 'number',
                def: 0,
                unit: 'kWh'
            }
        });

        await adapter.setObjectNotExistsAsync('TodayDischarged', {
            type: 'state',
            common: {
                name: 'Heute entladen',
                type: 'number',
                def: 0,
                unit: 'kWh'
            }
        });

        await adapter.setObjectNotExistsAsync('TodayCost', {
            type: 'state',
            common: {
                name: 'Kosten Bezug',
                type: 'number',
                def: 0,
                unit: 'Euro'
            }
        });

        await adapter.setObjectNotExistsAsync('TodayEarn', {
            type: 'state',
            common: {
                name: 'Erlös Verkauf',
                type: 'number',
                def: 0,
                unit: 'Euro'
            }
        });

        return true;
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