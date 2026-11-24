// A UI fragment: new members on built-in components, here
// Table.heat(column), which shades a column by its share of the column's
// largest value. ui.use turns it on for every UI script.
ui.fragment('heat')
  .on('Table')
  .method('heat', (table, ...columns) => {
    for (const c of columns)
      table.cellStyle(c, (v, all) => ({ shade: v / Math.max(1, ...all) }));
    return table;
  })
  .on('Stat')
  .method('share', (stat, of) =>
    stat.unit(
      ui.derive(
        { of },
        ({ of }) => `of ${Number(of).toLocaleString('en-GB')}`,
      ),
    ),
  );
ui.use('heat');
return [];
