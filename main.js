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
        config = this.config;

        //Create States
        await this.create_states();

        //Reset Trigger initialisieren
        resetMeterReadings = false;
        var interval = config.uptInterval * 1000;

        //Daten abrufen
        //try {
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
                var avgCons = this.calculate_avgCons(ConsPw);

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
                this.setState('ColecTm', { val: this.transform_Timestamp(arrValues.ESSRealtimeStatus.ColecTm), ack: true });
                this.setState('PowerOutletPw', { val: parseInt(arrValues.ESSRealtimeStatus.PowerOutletPw), ack: true });
                this.setState('GridPw', { val: GridPw, ack: true });
                this.setState('ConsPw', { val: ConsPw, ack: true });
                this.setState('BtSoc', { val: BtSoc, ack: true });
                this.setState('PcsPw', arrValues.ESSRealtimeStatus.PcsPw);
                this.setState('AbsPcsPw', arrValues.ESSRealtimeStatus.AbsPcsPw);
                this.setState('PvPw', PvPw);
                this.setState('GridStusCd', GridStusCd);
                this.setState('BtStusCd', BtStusCd);
                this.setState('BtPw', BtPw);
                this.setState('OperStusCd', parseInt(arrValues.ESSRealtimeStatus.OperStusCd));
                this.setState('EmsOpMode', parseInt(arrValues.ESSRealtimeStatus.EmsOpMode));
                this.setState('RankPer', arrValues.ESSRealtimeStatus.RankPer);
                this.setState('ErrorCnt', arrValues.ESSRealtimeStatus.ErrorCnt);
                this.setState('BtCap', BtCap);
                this.setState('BtLast', BtLast);
                this.setState('AvgCons', avgCons);

                //Tageswerte aktualisieren
                this.update_meter_readings(PvPw, GridStusCd, GridPw, BtStusCd, BtPw);
            });
        }, interval);

        job = schedule.scheduleJob('{"time":{"exactTime":true,"start":"23:59"},"period":{"days":1}}', this.reset_meter_readings);
        //} catch (ex) {
        //    this.log.error(ex.message);
        //}
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
        var ConsData = this.getState('ConsData').val;

        if (ConsData) {
            ConsData = JSON.parse(ConsData);
        } else {
            ConsData = [];
        };

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
        this.log.debug('Summe Verbrauch: ' + Math.round(totalCons * 100) / 100 + '; Anzahl Werte: ' + ConsData.length + '; Dauer: ' + (Math.round((ConsData.length * 2 / 60) * 100) / 100) + ' Min' + '; Durchschnitt: ' + avgCons + '; aktueller Verbrauch: ' + ConsPw)

        //Aktuelle Werte in Datenpunkten speichern
        this.setState('ConsData', { val: JSON.stringify(ConsData), ack: true });
        return avgCons;
    };

    //Zählerstände aktualisieren
    update_meter_readings(PvPw, GridStusCd, GridPw, BtStusCd, BtPw) {
        var TodayGen = parseFloat(this.getState('TodayGen').val)
        var TodayDemand = parseFloat(this.getState('TodayDemand').val);
        var TodayFeedIn = parseFloat(this.getState('TodayFeedIn').val);
        var TodayCharged = parseFloat(this.getState('TodayCharged').val);
        var TodayDischarged = parseFloat(this.getState('TodayDischarged').val);

        //Zählerstände speichern und zurücksetzen
        if (resetMeterReadings) {
            resetMeterReadings = false;

            if (config.saveMeterValuesToDb) {
                this.save_Meter_Values_to_db(TodayGen, TodayDemand, TodayFeedIn, TodayCharged, TodayDischarged);
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

        this.SetState('TodayGen', { val: TodayGen, ack: true });
        this.SetState('TodayDemand', { val: TodayDemand, ack: true });
        this.SetState('TodayFeedIn', { val: TodayFeedIn, ack: true });
        this.SetState('TodayCharged', { val: TodayCharged, ack: true });
        this.SetState('TodayDischarged', { val: TodayDischarged, ack: true });
        this.SetState('TodayCost', { val: TodayCost, ack: true });
        this.SetState('TodayEarn', { val: TodayEarn, ack: true });
    };

    //Convert Timestamp
    transform_Timestamp(input) {
        return new Date(input.toString().replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$4:$5:$6 $2/$3/$1')).toLocaleString()
    };

    //Datenbanktabelle anlegen
    create_db_table() {
        var qry = 'CREATE TABLE IF NOT EXISTS ' + config.dbName + '.' + config.dbTable + ' ( Timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, TodayGen float NOT NULL, TodayDemand float NOT NULL, TodayFeedIn float NOT NULL, TodayCharged float NOT NULL, TodayDischarged float NOT NULL, PRIMARY KEY (timestamp) ) ENGINE=InnoDB DEFAULT CHARSET=utf8;';

        this.sendTo(config.SQL_Instanz, 'query', qry, function (result) {
            if (result.error) {
                this.log.warn(result.error)
            } else {
                this.log.info('Rows: ' + JSON.stringify(result.result))
            }
        });
    }

    //Zählerstände in SQL-Datenbank speichern
    save_Meter_Values_to_db(TodayGen, TodayDemand, TodayFeedIn, TodayCharged, TodayDischarged) {
        var qry = 'INSERT INTO ' + config.dbName + '.' + config.dbTable + ' ( TodayGen, TodayDemand, TodayFeedIn, TodayCharged, TodayDischarged ) VALUES ( ' + TodayGen + ', ' + TodayDemand + ', ' + TodayFeedIn + ', ' + TodayCharged + ', ' + TodayDischarged + ' );';

        this.sendTo(config.SQL_Instanz, 'query', qry, function (result) {
            if (result.error) {
                this.log.warn(result.error)
            } else {
                this.log.debug('Rows: ' + JSON.stringify(result.result))
            }
        });
    }

    //Create States
    async create_states() {
        await this.setObjectNotExistsAsync('AbsPcsPw', {
            type: 'state',
            common: {
                name: 'Wechselrichterleistung absolut',
                type: 'number',
                unit: 'kW'
            }
        });

        await this.setObjectNotExistsAsync('AvgCons', {
            type: 'state',
            common: {
                name: 'Durchschnittsbedarf',
                type: 'number',
                unit: 'kW'
            }
        });

        await this.setObjectNotExistsAsync('BtCap', {
            type: 'state',
            common: {
                name: 'Batterie Kapazität',
                type: 'number',
                unit: 'kWh'
            }
        });

        await this.setObjectNotExistsAsync('BtLast', {
            type: 'state',
            common: {
                name: 'Restlaufzeit (laden/entladen)',
                type: 'number',
                unit: 'Min'
            }
        });

        await this.setObjectNotExistsAsync('BtPw', {
            type: 'state',
            common: {
                name: 'Batterieleistung',
                type: 'number',
                unit: 'kW'
            }
        });

        await this.setObjectNotExistsAsync('BtSoc', {
            type: 'state',
            common: {
                name: 'Batterie Ladezustand',
                type: 'number',
                unit: '%'
            }
        });

        await this.setObjectNotExistsAsync('BtStusCd', {
            type: 'state',
            common: {
                name: 'Batteriestatuscode',
                type: 'number',
                unit: '%',
                states: {
                    '0': 'Entladen',
                    '1': 'Laden',
                    '2': 'Geladen'
                }
            }
        });

        await this.setObjectNotExistsAsync('ColecTm', {
            type: 'state',
            common: {
                name: 'Abfragezeitpunkt',
                type: 'string',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('ConsData', {
            type: 'state',
            common: {
                name: 'Verbrauchswerte Durchschnittsverbrauch',
                type: 'string',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('ConsPw', {
            type: 'state',
            common: {
                name: 'Bedarf Leistung',
                type: 'number',
                unit: 'kW'
            }
        });

        await this.setObjectNotExistsAsync('EmsOpMode', {
            type: 'state',
            common: {
                name: 'Bedarf Leistung',
                type: 'number',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('ErrorCnt', {
            type: 'state',
            common: {
                name: 'Anzahl Fehler',
                type: 'number',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('GridPw', {
            type: 'state',
            common: {
                name: 'Netzleistung',
                type: 'number',
                unit: 'kW'
            }
        });

        await this.setObjectNotExistsAsync('GridStusCd', {
            type: 'state',
            common: {
                name: 'Netzstatuscode',
                type: 'number',
                unit: 'kW',
                states: {
                    '0': 'Bezug',
                    '1': 'Einspeisung'
                }
            }
        });

        await this.setObjectNotExistsAsync('OperStusCd', {
            type: 'state',
            common: {
                name: 'OperStusCd',
                type: 'number',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('PcsPw', {
            type: 'state',
            common: {
                name: 'Wechselrichterleistung',
                type: 'number',
                unit: 'W'
            }
        });

        await this.setObjectNotExistsAsync('PowerOutletPw', {
            type: 'state',
            common: {
                name: 'PowerOutletPw',
                type: 'number',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('PvPw', {
            type: 'state',
            common: {
                name: 'Photovoltaikleistung',
                type: 'number',
                unit: 'kW'
            }
        });

        await this.setObjectNotExistsAsync('RankPer', {
            type: 'state',
            common: {
                name: 'RankPer',
                type: 'number',
                unit: ''
            }
        });

        await this.setObjectNotExistsAsync('TodayDemand', {
            type: 'state',
            common: {
                name: 'Heute bezogen',
                type: 'number',
                unit: 'kWh'
            }
        });

        await this.setObjectNotExistsAsync('TodayFeedIn', {
            type: 'state',
            common: {
                name: 'Heute eingespeist',
                type: 'number',
                unit: 'kWh'
            }
        });

        await this.setObjectNotExistsAsync('TodayGen', {
            type: 'state',
            common: {
                name: 'Heute generiert',
                type: 'number',
                unit: 'kWh'
            }
        });

        await this.setObjectNotExistsAsync('TodayCharged', {
            type: 'state',
            common: {
                name: 'Heute geladen',
                type: 'number',
                unit: 'kWh'
            }
        });

        await this.setObjectNotExistsAsync('TodayDischarged', {
            type: 'state',
            common: {
                name: 'Heute entladen',
                type: 'number',
                unit: 'kWh'
            }
        });

        await this.setObjectNotExistsAsync('TodayCost', {
            type: 'state',
            common: {
                name: 'Kosten Bezug',
                type: 'number',
                unit: 'Euro'
            }
        });

        await this.setObjectNotExistsAsync('TodayEarn', {
            type: 'state',
            common: {
                name: 'Erlös Verkauf',
                type: 'number',
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