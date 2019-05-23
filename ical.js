(function(name, definition) {

	/****************
	 *  A tolerant, minimal icalendar parser
	 *  (http://tools.ietf.org/html/rfc5545)
	 *
	 *  <peterbraden@peterbraden.co.uk>
	 * **************/

	if (typeof module !== 'undefined') {
		module.exports = definition();
	} else if (typeof define === 'function' && typeof define.amd === 'object'){
		define(definition);
	} else {
		this[name] = definition();
	}

}('ical', function() {
	'use strict';

	const xSlashComma = /\\\,/g;
	const xSlashSemicolon = /\\\;/g;
	const xSlashNewline = /\\[nN]/g;
	const xSlashBackslash = /\\\\/g;
	const xDate = /^(\d{4})(\d{2})(\d{2})$/;
	const xRfcDate = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;
	const xSeparatorPattern = /\s*,\s*/g;
	const xCustomProperty = /X\-[\w\-]+/;
	const xNewline = /\r?\n/;
	const xSpaceTab = /[ \t]/;


	// Unescape Text re RFC 4.3.11
	const text = (txt='')=>txt
		.replace(xSlashComma, ',')
		.replace(xSlashSemicolon, ';')
		.replace(xSlashNewline, '\n')
		.replace(xSlashBackslash, '\\');

	const parseParams = params=>{
		const out = {};
		params.forEach(param=>{
			if (!~param.indexOf('=')) return;
			const segs = param.split('=');
			out[segs[0]] = parseValue(segs.slice(1).join('='));
		});
		return out;
	};

	const parseValue = val=>{
		if ('TRUE' === val) return true;
		if ('FALSE' === val) return false;
		const number = Number(val);
		if (!isNaN(number)) return number;
		return val;
	};

	const storeValParam = name=>(val, curr)=>{
		var current = curr[name];
		if (Array.isArray(current)) {
			current.push(val);
			return curr;
		}

		if (current != null) {
			curr[name] = [current, val];
			return curr;
		}

		curr[name] = val;
		return curr;
	};

	const storeParam = name=>(val, params, curr)=>{
		const data = ((params && params.length && !(params.length == 1 && params[0] === 'CHARSET=utf-8')) ?
			{ params: parseParams(params), val: text(val) } :
			text(val)
		);

		return storeValParam(name)(data, curr);
	};

	const addTZ = (dt, params)=>{
		var p = parseParams(params);
		if (params && p) dt.tz = p.TZID
		return dt
	};

	const dateParam = name=>(val, params, curr)=>{
		let newDate = text(val);

		if (params && params[0] === "VALUE=DATE") {
			// Just Date
			const parts1 = xDate.exec(val);
			if (parts1 !== null) {
				// No TZ info - assume same timezone as this computer
				newDate = addTZ(new Date(parts1[1], parseInt(parts1[2], 10)-1, parts1[3]), params);
				newDate.dateOnly = true;

				// Store as string - worst case scenario
				return storeValParam(name)(newDate, curr);
			}
		}


		//typical RFC date-time format
		const parts2 = xRfcDate.exec(val);
		if (parts2 !== null) {
			if (parts2[7] == 'Z'){ // GMT
				newDate = new Date(Date.UTC(
					parseInt(parts2[1], 10),
					parseInt(parts2[2], 10)-1,
					parseInt(parts2[3], 10),
					parseInt(parts2[4], 10),
					parseInt(parts2[5], 10),
					parseInt(parts2[6], 10 )
				));
				// TODO add tz
			} else {
				newDate = new Date(
					parseInt(parts2[1], 10),
					parseInt(parts2[2], 10)-1,
					parseInt(parts2[3], 10),
					parseInt(parts2[4], 10),
					parseInt(parts2[5], 10),
					parseInt(parts2[6], 10)
				);
			}

			newDate = addTZ(newDate, params);
		}


		// Store as string - worst case scenario
		return storeValParam(name)(newDate, curr)
	};


	const geoParam = name=>(val, params, curr)=>{
		storeParam(val, params, curr);
		const parts = val.split(';');
		curr[name] = {lat:Number(parts[0]), lon:Number(parts[1])};
		return curr;
	};

	const categoriesParam = name=>(val, params, curr)=>{
		storeParam(val, params, curr);
		if (curr[name] === undefined) {
			curr[name] = val ? val.split(xSeparatorPattern) : []
		} else {
			if (val) curr[name] = curr[name].concat(val.split(xSeparatorPattern))
		};
		return curr
	};

	// EXDATE is an entry that represents exceptions to a recurrence rule (ex: "repeat every day except on 7/4").
	// The EXDATE entry itself can also contain a comma-separated list, so we make sure to parse each date out separately.
	// There can also be more than one EXDATE entries in a calendar record.
	// Since there can be multiple dates, we create an array of them.  The index into the array is the ISO string of the date itself, for ease of use.
	// i.e. You can check if ((curr.exdate != undefined) && (curr.exdate[date iso string] != undefined)) to see if a date is an exception.
	// NOTE: This specifically uses date only, and not time.  This is to avoid a few problems:
	//    1. The ISO string with time wouldn't work for "floating dates" (dates without timezones).
	//       ex: "20171225T060000" - this is supposed to mean 6 AM in whatever timezone you're currently in
	//    2. Daylight savings time potentially affects the time you would need to look up
	//    3. Some EXDATE entries in the wild seem to have times different from the recurrence rule, but are still excluded by calendar programs.  Not sure how or why.
	//       These would fail any sort of sane time lookup, because the time literally doesn't match the event.  So we'll ignore time and just use date.
	//       ex: DTSTART:20170814T140000Z
	//             RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=MO,TU
	//             EXDATE:20171219T060000
	//       Even though "T060000" doesn't match or overlap "T1400000Z", it's still supposed to be excluded?  Odd. :(
	// TODO: See if this causes any problems with events that recur multiple times a day.
	const exdateParam = name=>(val, params, curr)=>{
		curr[name] = curr[name] || [];
		(val ? val.split(xSeparatorPattern) : []).forEach(entry=>{
				const exdate = [];
				dateParam(name)(entry, params, exdate);

				if (exdate[name]) {
					if (typeof exdate[name].toISOString === 'function') {
						curr[name][exdate[name].toISOString().substring(0, 10)] = exdate[name];
					} else {
						console.error("No toISOString function in exdate[name]", exdate[name]);
					}
				}
			}
		);
		return curr;
	};

	// RECURRENCE-ID is the ID of a specific recurrence within a recurrence rule.
	// TODO:  It's also possible for it to have a range, like "THISANDPRIOR", "THISANDFUTURE".  This isn't currently handled.
	const recurrenceParam = name=>dateParam(name);

	const addFBType = (fb, params)=> {
		var p = parseParams(params);
		if (params && p) fb.type = p.FBTYPE || "BUSY";
		return fb;
	};

	const freebusyParam = name=>(val, params, curr)=>{
		const fb = addFBType({}, params);

		curr[name] = curr[name] || [];
		curr[name].push(fb);

		storeParam(val, params, fb);

		const parts = val.split('/');
		['start', 'end'].forEach((name, index)=>dateParam(name)(parts[index], params, fb));
		return curr;
	};

	return {
		objectHandlers : {
			'BEGIN' : function(component, params, curr, stack){
				stack.push(curr);
				return {type:component, params:params}
			},

			'END' : function(component, params, curr, stack){
				// prevents the need to search the root of the tree for the VCALENDAR object
				if (component === "VCALENDAR") {
					//scan all high level object in curr and drop all strings
					Object.keys(curr).forEach(key=>{
						if (typeof curr[key] === 'string') delete curr[key];
					});
					return curr
				}

				const par = stack.pop();

				if (curr.uid) {
					// If this is the first time we run into this UID, just save it.
					if (par[curr.uid] === undefined) {
						par[curr.uid] = curr;
					} else {
						// If we have multiple ical entries with the same UID, it's either going to be a
						// modification to a recurrence (RECURRENCE-ID), and/or a significant modification
						// to the entry (SEQUENCE).

						// TODO: Look into proper sequence logic.

						if (curr.recurrenceid === undefined) {
							// If we have the same UID as an existing record, and it *isn't* a specific recurrence ID,
							// not quite sure what the correct behaviour should be.  For now, just take the new information
							// and merge it with the old record by overwriting only the fields that appear in the new record.
							for (let key in curr) par[curr.uid][key] = curr[key];
						}
					}

					// If we have recurrence-id entries, list them as an array of recurrences keyed off of recurrence-id.
					// To use - as you're running through the dates of an rrule, you can try looking it up in the recurrences
					// array.  If it exists, then use the data from the calendar object in the recurrence instead of the parent
					// for that day.

					// NOTE:  Sometimes the RECURRENCE-ID record will show up *before* the record with the RRULE entry.  In that
					// case, what happens is that the RECURRENCE-ID record ends up becoming both the parent record and an entry
					// in the recurrences array, and then when we process the RRULE entry later it overwrites the appropriate
					// fields in the parent record.

					if (curr.recurrenceid != null) {
						// TODO:  Is there ever a case where we have to worry about overwriting an existing entry here?

						// Create a copy of the current object to save in our recurrences array.  (We *could* just do par = curr,
						// except for the case that we get the RECURRENCE-ID record before the RRULE record.  In that case, we
						// would end up with a shared reference that would cause us to overwrite *both* records at the point
						// that we try and fix up the parent record.)
						const recurrenceObj = {};
						for (let key in curr) recurrenceObj[key] = curr[key];
						if (recurrenceObj.recurrences != undefined) delete recurrenceObj.recurrences;

						// If we don't have an array to store recurrences in yet, create it.
						if (par[curr.uid].recurrences === undefined) par[curr.uid].recurrences = new Array();

						// Save off our cloned recurrence object into the array, keyed by date but not time.
						// We key by date only to avoid timezone and "floating time" problems (where the time isn't associated with a timezone).
						// TODO: See if this causes a problem with events that have multiple recurrences per day.
						if (typeof curr.recurrenceid.toISOString === 'function') {
							par[curr.uid].recurrences[curr.recurrenceid.toISOString().substring(0,10)] = recurrenceObj;
						} else {
							console.error("No toISOString function in curr.recurrenceid", curr.recurrenceid);
						}
					}

					// One more specific fix - in the case that an RRULE entry shows up after a RECURRENCE-ID entry,
					// let's make sure to clear the recurrenceid off the parent field.
					if ((par[curr.uid].rrule != undefined) && (par[curr.uid].recurrenceid != undefined)) {
						delete par[curr.uid].recurrenceid;
					}

				} else {
					par[Math.random() * 100000] = curr;  // Randomly assign ID : TODO - use true GUID
				}

				return par
			},

			'SUMMARY' : storeParam('summary'),
			'DESCRIPTION' : storeParam('description'),
			'URL' : storeParam('url'),
			'UID' : storeParam('uid'),
			'LOCATION' : storeParam('location'),
			'DTSTART' : dateParam('start'),
			'DTEND' : dateParam('end'),
			'EXDATE' : exdateParam('exdate'),
			'CLASS' : storeParam('class'),
			'TRANSP' : storeParam('transparency'),
			'GEO' : geoParam('geo'),
			'PERCENT-COMPLETE': storeParam('completion'),
			'COMPLETED': dateParam('completed'),
			'CATEGORIES': categoriesParam('categories'),
			'FREEBUSY': freebusyParam('freebusy'),
			'DTSTAMP': dateParam('dtstamp'),
			'CREATED': dateParam('created'),
			'LAST-MODIFIED': dateParam('lastmodified'),
			'RECURRENCE-ID': recurrenceParam('recurrenceid')
		},


		handleObject : function(name, val, params, ctx, stack, line){
			const self = this;

			if (self.objectHandlers[name]) return self.objectHandlers[name](val, params, ctx, stack, line);

			//handling custom properties
			if(name.match(xCustomProperty) && stack.length > 0) {
				//trimming the leading and perform storeParam
				name = name.substring(2);
				return (storeParam(name))(val, params, ctx, stack, line);
			}

			return storeParam(name.toLowerCase())(val, params, ctx);
		},


		parseICS : function(str){
			const self = this;
			const lines = str.split(xNewline);
			const stack = [];

			let ctx = {};


			for (var i = 0, ii = lines.length, l = lines[0]; i<ii; i++, l=lines[i]){
				//Unfold : RFC#3.1
				while (lines[i+1] && xSpaceTab.test(lines[i+1][0])) {
					l += lines[i+1].slice(1);
					i += 1;
				}

				const kv = l.split(":");
				if (kv.length < 2) continue; // Invalid line - must have k&v

				// Although the spec says that vals with colons should be quote wrapped
				// in practise nobody does, so we assume further colons are part of the
				// val
				const kp = kv[0].split(";");
				ctx = self.handleObject(kp[0], kv.slice(1).join(":"), kp.slice(1), ctx, stack, l) || {}
			}

			// type and params are added to the list of items, get rid of them.
			delete ctx.type;
			delete ctx.params;

			return ctx;
		}

	}
}));
