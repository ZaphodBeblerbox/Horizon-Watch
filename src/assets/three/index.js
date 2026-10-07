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
import * as infra from "./infra.js"

export const MODELS = {
    vessel_tanker: ships.tanker,
    vessel_container: ships.containerShip,
    vessel_bulk: ships.bulkCarrier,
    vessel_lng: ships.lngCarrier,
    vessel_general: ships.generalCargo,
    vessel_offshore: ships.offshoreSupply,
    vessel_yacht: ships.yacht,
    vessel_passenger: ships.passengerShip,
    vessel_military: ships.warship,
    vessel_fishing: ships.fishingVessel,
    aircraft_cargo: aircraft.freighter,
    aircraft_passenger: aircraft.airliner,
    aircraft_business: aircraft.bizjet,
    helicopter: aircraft.helicopter,
    aircraft_widebody: aircraft.widebody,
    aircraft_regional: aircraft.regionalJet,
    aircraft_turboprop: aircraft.turboprop,
    aircraft_light: aircraft.lightProp,
    aircraft_military: aircraft.fighter,
    vehicle_truck: vehicles.truck,
    vehicle_car: vehicles.car,
    vehicle_armoured: vehicles.armoured,
    factory: sites.factory,
    office: sites.office,
    warehouse: sites.warehouse,
    refinery: sites.refinery,
    power_plant: sites.powerPlant,
    substation: sites.substation,
    nuclear_plant: infra.nuclearPlant,
    wind_farm: infra.windFarm,
    wind_turbine: infra.windTurbine,
    solar_farm: infra.solarFarm,
    hydro_dam: infra.hydroDam,
    power_line: infra.pylon,
    pylon: infra.pylon,
    pipeline: infra.pipeline,
    oil_well: infra.oilWell,
    tank_farm: infra.tankFarm,
    telecom_mast: infra.telecomMast,
    data_center: infra.dataCenter,
    subsea_cable: infra.subseaCable,
    port: sites.port,
    airport: sites.airport,
    person: vehicles.person,
    team: vehicles.team,
}

export function build(kind) {
    const f = MODELS[kind]
    return f ? f() : null
}
