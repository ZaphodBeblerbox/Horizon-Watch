/**
 * index.js — every asset kind and the model that draws it.
 *
 * The keys are the register's kinds (backend owned_assets.KINDS). build()
 * returns {group, setting}; models are built fresh each call (they are
 * cheap to build and share their materials through kit.mat's cache).
 */
import * as ships from "./ships.js"
import * as aircraft from "./aircraft.js"
import * as vehicles from "./vehicles.js"
import * as sites from "./sites.js"

export const MODELS = {
    vessel_tanker: ships.tanker,
    vessel_container: ships.containerShip,
    vessel_bulk: ships.bulkCarrier,
    vessel_lng: ships.lngCarrier,
    vessel_general: ships.generalCargo,
    vessel_offshore: ships.offshoreSupply,
    vessel_yacht: ships.yacht,
    aircraft_cargo: aircraft.freighter,
    aircraft_passenger: aircraft.airliner,
    aircraft_business: aircraft.bizjet,
    helicopter: aircraft.helicopter,
    vehicle_truck: vehicles.truck,
    vehicle_car: vehicles.car,
    vehicle_armoured: vehicles.armoured,
    factory: sites.factory,
    office: sites.office,
    warehouse: sites.warehouse,
    refinery: sites.refinery,
    power_plant: sites.powerPlant,
    substation: sites.substation,
    port: sites.port,
    airport: sites.airport,
    person: vehicles.person,
    team: vehicles.team,
}

export function build(kind) {
    const f = MODELS[kind]
    return f ? f() : null
}
